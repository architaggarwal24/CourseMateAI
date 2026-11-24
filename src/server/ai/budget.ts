// The AI money limits, made so that no one can spend past them (Stage B1 of the budgets pass):
//   global          the daily spend cap (usage.ts: app_settings "ai_daily_cap_usd", never off, never above the ceiling)
//   plan:<tier>     all users of a plan together, per day (e.g. the free plan's $0.25)
//   user:<id>       one user, per day (the limit set for their plan)
//   tools           the free tools on the public pages, per day
// Reserve, then settle: before a call to a paid model, its worst-case cost is reserved against every scope that
// applies, in one D1 batch (one transaction). The ai_budget table's CHECK refuses any row whose spent + reserved would
// pass its limit, so the whole batch rolls back and no scope is touched: all or nothing, with no window for parallel
// requests to slip through. A refused model is skipped and the route's next one is tried; the free Workers AI model
// costs nothing, needs no reservation and always answers last. After the call, settle replaces the reservation with
// the real cost (in the same batch as the usage meters).
// The worst case is a true ceiling: input tokens are counted as UTF-8 bytes (no tokenizer makes more tokens than
// bytes), output as the max output tokens the call asks for (providers count thinking inside it). So a call can't cost
// more than it reserved unless a model's price in MODEL_PRICES_JSON is wrong.
// Owners skip the plan and user budgets (they have no quota), never the global cap. Limits are US dollars, saved in
// app_settings "ai_budgets" by the owner in Admin; null means no limit at that level (the global cap still applies).
// A crash between reserve and settle leaves the reservation in place until the day ends: the budget is lower for the
// rest of the day, never higher.
// Mana (account/wallet.ts): when a user's own budget has no room, their bought Mana can pay instead. A Mana call
// reserves against the wallet (whose CHECK keeps reservations inside the balance) and the global cap only, in the
// same one-batch way; settling takes the real cost off the balance and adds it to the day's "use" row in the ledger.
import { and, eq, inArray, not, like, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../db";
import { aiBudget, aiWallet, appSettings, manaLedger } from "../db/schema";
import { HttpError } from "../http";
import { TIERS, nowIso, type Tier } from "../account/plans";
import { CAP_KEY, capCeilingUsd, capFrom, costMicroUsd, dayOf, price, recordAnonymousCallQuery, recordCallQueries } from "./usage";
import { IMAGE_TOKENS, outputCeiling } from "./providers";
import type { Target } from "./models";

type Env = Record<string, string | undefined>;
/** US dollars a day, or null for no limit at this level. */
export type Usd = number | null;
export interface Budgets {
  /** All users of a plan together, per day. */
  plan: Record<Tier, Usd>;
  /** Each user of a plan, per day. */
  user: Record<Tier, Usd>;
  /** The free tools on the public pages, per day. */
  tools: Usd;
}

export const BUDGETS_KEY = "ai_budgets";

/**
 * The starting limits. Per user, a paid plan's day stays under its monthly price over 30 days (Scholar ₹149, Sage
 * ₹299, Archmage ₹599 at about ₹84 to the dollar), so no subscriber can cost more than they pay.
 */
export const DEFAULT_BUDGETS: Budgets = {
  plan: { apprentice: 0.25, scholar: null, sage: null, archmage: null },
  user: { apprentice: 0.02, scholar: 0.05, sage: 0.1, archmage: 0.2 },
  tools: 0.1,
};

const micro = (usd: number) => Math.round(usd * 1e6);

function cleanUsd(v: unknown, ceiling: number, fallback: Usd): Usd {
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, ceiling) : fallback;
}

/** The saved limits laid over the defaults; anything unreadable keeps its default, nothing passes the ceiling. */
export function parseBudgets(raw: string | null | undefined, env: Env = process.env): Budgets {
  const ceiling = capCeilingUsd(env);
  let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) ?? {} : {}; } catch { data = {}; }
  const part = (k: "plan" | "user") => {
    const saved = (data[k] && typeof data[k] === "object" ? data[k] : {}) as Record<string, unknown>;
    return Object.fromEntries(TIERS.map((t) => [t, t in saved ? cleanUsd(saved[t], ceiling, DEFAULT_BUDGETS[k][t]) : cleanUsd(DEFAULT_BUDGETS[k][t], ceiling, null)])) as Record<Tier, Usd>;
  };
  return { plan: part("plan"), user: part("user"), tools: "tools" in data ? cleanUsd(data.tools, ceiling, DEFAULT_BUDGETS.tools) : cleanUsd(DEFAULT_BUDGETS.tools, ceiling, null) };
}

function invalid(field: string, ceiling: number): HttpError {
  return new HttpError(400, "invalid_budget", `Each budget is a number of US dollars from 0 to ${ceiling}, or empty for no limit.`, null, { field, max: ceiling });
}

/** A budgets object from Admin, checked strictly (a bad value is an error, not a quiet default). */
export function checkBudgets(input: unknown, env: Env = process.env): Budgets {
  const ceiling = capCeilingUsd(env);
  if (!input || typeof input !== "object") throw invalid("budgets", ceiling);
  const d = input as Record<string, unknown>;
  const one = (v: unknown, field: string): Usd => {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > ceiling) throw invalid(field, ceiling);
    return v;
  };
  const part = (k: "plan" | "user") => {
    const p = d[k];
    if (!p || typeof p !== "object") throw invalid(k, ceiling);
    return Object.fromEntries(TIERS.map((t) => [t, one((p as Record<string, unknown>)[t] ?? null, `${k}.${t}`)])) as Record<Tier, Usd>;
  };
  return { plan: part("plan"), user: part("user"), tools: one(d.tools ?? null, "tools") };
}

export async function saveBudgets(db: Db, b: Budgets): Promise<void> {
  const value = JSON.stringify(b);
  await db.insert(appSettings).values({ key: BUDGETS_KEY, value, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: nowIso() } });
}

export interface Limits { capUsd: number; budgets: Budgets }

/** The cap and the budgets, in one read. */
export async function loadLimits(db: Db, env: Env = process.env): Promise<Limits> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, [CAP_KEY, BUDGETS_KEY])).all();
  const value = (k: string) => rows.find((r) => r.key === k)?.value;
  return { capUsd: capFrom(value(CAP_KEY), env), budgets: parseBudgets(value(BUDGETS_KEY), env) };
}

export interface Scope { key: string; limitMicro: number }
type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

/** The scopes a user's call is limited by: their own and their plan's budget (not for owners), and the global cap. */
export function userScopes(who: { id: number; owner: boolean; tier: Tier }, lim: Limits): Scope[] {
  const out: Scope[] = [];
  if (!who.owner) {
    const mine = lim.budgets.user[who.tier];
    const plan = lim.budgets.plan[who.tier];
    if (mine !== null) out.push({ key: `user:${who.id}`, limitMicro: micro(mine) });
    if (plan !== null) out.push({ key: `plan:${who.tier}`, limitMicro: micro(plan) });
  }
  out.push({ key: "global", limitMicro: micro(lim.capUsd) });
  return out;
}

/** The scopes a free-tool run is limited by: the free tools' budget and the global cap. */
export function toolScopes(lim: Limits): Scope[] {
  return [
    ...(lim.budgets.tools !== null ? [{ key: "tools", limitMicro: micro(lim.budgets.tools) }] : []),
    { key: "global", limitMicro: micro(lim.capUsd) },
  ];
}

const bytes = new TextEncoder();
/**
 * At most this many input tokens: UTF-8 bytes (a token is never less than one byte), plus room for message framing,
 * plus IMAGE_TOKENS for each picture.
 */
export function worstInputTokens(messages: { content: string; images?: unknown[] }[]): number {
  return messages.reduce((n, m) => n + bytes.encode(m.content || "").length + 8 + (m.images?.length ?? 0) * IMAGE_TOKENS, 16);
}

/** The most a call to this target can cost, in micro-dollars (0 for Workers AI and other free models). */
export function worstCostMicro(t: Pick<Target, "provider" | "model">, messages: { content: string; images?: unknown[] }[], opts: { maxOutputTokens?: number }, env: Env = process.env): number {
  const { rate } = price(t.provider, t.model, env);
  const raw = worstInputTokens(messages) * rate[0] + outputCeiling(t, opts) * rate[1];   // tokens * $/1M = micro-dollars
  return raw > 0 ? Math.ceil(raw) : 0;
}

/** A reservation: settle it (or release it) exactly once. A free call holds nothing. `wallet`: paid with Mana. */
export interface Hold { day: string; worstMicro: number; scopes: string[]; wallet?: number }

/** A D1 or Drizzle error caused by the ai_budget CHECK (the error may be wrapped in `cause`). */
function overLimit(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    if (/CHECK constraint failed/i.test(String((x as Error).message ?? x))) return true;
  }
  return false;
}

/**
 * Reserve `worstMicro` against every scope, all or nothing. null: some limit would be passed (nothing was taken).
 * A free call (worst 0) is always allowed and touches nothing.
 */
export async function reserve(db: Db, scopes: Scope[], worstMicro: number, now = new Date(), wallet?: number): Promise<Hold | null> {
  const day = dayOf(now);
  if (worstMicro <= 0 || (!scopes.length && wallet === undefined)) return { day, worstMicro: 0, scopes: [] };
  if (scopes.some((s) => s.limitMicro < worstMicro)) return null;
  const stmts: BatchItem<"sqlite">[] = scopes.map((s) => db.insert(aiBudget)
    .values({ scope: s.key, day, spentMicro: 0, reservedMicro: worstMicro, limitMicro: s.limitMicro })
    .onConflictDoUpdate({
      target: [aiBudget.scope, aiBudget.day],
      set: { reservedMicro: sql`${aiBudget.reservedMicro} + ${worstMicro}`, limitMicro: s.limitMicro },
    }));
  // Mana: the wallet is made sure of (empty if it's new), then the reservation is added, which its CHECK refuses past
  // the balance. (An insert carrying the reservation would be refused by the CHECK before the upsert could merge it.)
  // A refusal rolls the whole batch back, so no empty wallet is left behind.
  if (wallet !== undefined) {
    stmts.push(db.insert(aiWallet).values({ userId: wallet, balanceMicro: 0, reservedMicro: 0 }).onConflictDoNothing());
    stmts.push(db.update(aiWallet).set({ reservedMicro: sql`${aiWallet.reservedMicro} + ${worstMicro}` }).where(eq(aiWallet.userId, wallet)));
  }
  try {
    await db.batch(stmts as Batch);
  } catch (e) {
    if (overLimit(e)) return null;
    throw e;
  }
  return { day, worstMicro, scopes: scopes.map((s) => s.key), ...(wallet !== undefined ? { wallet } : {}) };
}

/**
 * Settle a reservation to what the call really cost. The limit is raised to fit if the real cost came out higher
 * (only possible with a wrong price), so settling never fails; the next reservation sets the real limit again and
 * is refused while the scope is over it.
 */
export function settleQueries(db: Db, hold: Hold, actualMicro: number) {
  const a = Math.max(0, Math.round(actualMicro));
  const w = hold.worstMicro;
  const out: BatchItem<"sqlite">[] = [];
  if (hold.scopes.length) {
    out.push(db.update(aiBudget).set({
      spentMicro: sql`${aiBudget.spentMicro} + ${a}`,
      reservedMicro: sql`max(${aiBudget.reservedMicro} - ${w}, 0)`,
      limitMicro: sql`max(${aiBudget.limitMicro}, ${aiBudget.spentMicro} + ${a} + max(${aiBudget.reservedMicro} - ${w}, 0))`,
    }).where(and(eq(aiBudget.day, hold.day), inArray(aiBudget.scope, hold.scopes))));
  }
  if (hold.wallet !== undefined && w > 0) {
    // the balance never drops below what is still reserved (only a wrong price could make a call cost more)
    out.push(db.update(aiWallet).set({
      balanceMicro: sql`max(${aiWallet.balanceMicro} - ${a}, max(${aiWallet.reservedMicro} - ${w}, 0))`,
      reservedMicro: sql`max(${aiWallet.reservedMicro} - ${w}, 0)`,
      updatedAt: new Date().toISOString(),
    }).where(eq(aiWallet.userId, hold.wallet)));
    if (a > 0) {
      out.push(db.insert(manaLedger).values({ userId: hold.wallet, kind: "use", ref: `${hold.wallet}:${hold.day}`, micro: a, createdAt: new Date().toISOString() })
        .onConflictDoUpdate({ target: [manaLedger.kind, manaLedger.ref], set: { micro: sql`${manaLedger.micro} + ${a}` } }));
    }
  }
  return out;
}

/** Settle a reservation on its own (no meters with it). */
export async function settle(db: Db, hold: Hold, actualMicro: number): Promise<void> {
  const q = settleQueries(db, hold, actualMicro);
  if (q.length) await db.batch(q as Batch);
}

/** Give a reservation back whole: no model answered on it. */
export async function release(db: Db, hold: Hold): Promise<void> {
  await settle(db, hold, 0);
}

/** Meter a user's call and settle its reservation, in one round trip. */
export async function meter(db: Db, call: Parameters<typeof recordCallQueries>[1], hold: Hold): Promise<void> {
  const cost = costMicroUsd(call.target.provider, call.target.model, Math.max(0, call.tokensIn), Math.max(0, call.tokensOut));
  await db.batch([...recordCallQueries(db, call), ...settleQueries(db, hold, cost)] as Batch);
}

/** Meter a free-tool run and settle its reservation, in one round trip. */
export async function meterAnonymous(db: Db, call: Parameters<typeof recordAnonymousCallQuery>[1], hold: Hold): Promise<void> {
  const cost = costMicroUsd(call.target.provider, call.target.model, Math.max(0, call.tokensIn), Math.max(0, call.tokensOut));
  await db.batch([recordAnonymousCallQuery(db, call), ...settleQueries(db, hold, cost)] as Batch);
}

/** Admin: today's money per scope (plans, the free tools and the global cap; users are left out). */
export async function budgetToday(db: Db, now = new Date()): Promise<Record<string, { spent_usd: number; reserved_usd: number }>> {
  const rows = await db.select().from(aiBudget).where(and(eq(aiBudget.day, dayOf(now)), not(like(aiBudget.scope, "user:%")))).all();
  return Object.fromEntries(rows.map((r) => [r.scope, { spent_usd: r.spentMicro / 1e6, reserved_usd: r.reservedMicro / 1e6 }]));
}

/**
 * Account -> Plan & usage: one user's own AI budget today (used against its limit; null: no limit at that level) and
 * what is in their Mana wallet, in one round trip.
 */
export async function allowanceToday(db: Db, who: { id: number; owner: boolean; tier: Tier }, now = new Date(), env: Env = process.env) {
  const [settings, budget, wallet] = await db.batch([
    db.select().from(appSettings).where(inArray(appSettings.key, [CAP_KEY, BUDGETS_KEY])),
    db.select().from(aiBudget).where(and(eq(aiBudget.scope, `user:${who.id}`), eq(aiBudget.day, dayOf(now)))),
    db.select().from(aiWallet).where(eq(aiWallet.userId, who.id)),
  ]);
  const budgets = parseBudgets(settings.find((r) => r.key === BUDGETS_KEY)?.value, env);
  const limit = who.owner ? null : budgets.user[who.tier];
  const used = ((budget[0]?.spentMicro ?? 0) + (budget[0]?.reservedMicro ?? 0)) / 1e6;
  return {
    limit_usd: limit,
    used_usd: used,
    share: limit === null ? 0 : limit <= 0 ? 1 : Math.min(1, used / limit),
    wallet_micro: Math.max(0, (wallet[0]?.balanceMicro ?? 0) - (wallet[0]?.reservedMicro ?? 0)),
  };
}
