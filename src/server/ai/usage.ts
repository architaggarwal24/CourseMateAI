// AI use: the plan's quotas (calls a day, tokens a month), what each model costs, and the global daily spend cap.
//   MODEL_PRICES_JSON={"gemini:gemini-3.8-flash": [0.3, 2.5], "claude:*": [3, 15]}   US dollars per 1M tokens (in, out)
// Workers AI counts 0 (the free daily allowance). An API model without a price is counted at ESTIMATE (and shown
// as estimated in Admin), so the cap still protects you until you set its real price.
// The cap: app_settings "ai_daily_cap_usd" (set in Admin by the owner) or AI_DAILY_CAP_USD (default 2). It is never off and
// never above AI_DAILY_CAP_MAX_USD (default 20), which only a dashboard change raises.
// Once the day's API spend reaches it, everyone's calls go to Workers AI until midnight UTC.
import { and, eq, gte, like, sql } from "drizzle-orm";
import type { Db } from "../db";
import { aiUsage, appSettings, usageDaily } from "../db/schema";
import { limits, nowIso, planLimit, type Tier } from "../plans";
import type { Job, Target } from "./models";

export const ESTIMATE: [number, number] = [1, 4];
export const DEFAULT_CAP_USD = 2;
export const CAP_KEY = "ai_daily_cap_usd";
export const DEFAULT_CAP_CEILING_USD = 20;

type Env = Record<string, string | undefined>;

export const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);
const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

function prices(env: Env): Record<string, [number, number]> {
  try {
    const data = JSON.parse(env.MODEL_PRICES_JSON || "{}");
    const out: Record<string, [number, number]> = {};
    for (const [k, v] of Object.entries(data)) {
      if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && x >= 0)) out[k.toLowerCase()] = [v[0], v[1]];
    }
    return out;
  } catch {
    return {};
  }
}

/** US dollars per 1M tokens (in, out), and whether it is a real price. */
export function price(provider: string, model: string, env: Env = process.env): { rate: [number, number]; priced: boolean } {
  if (provider === "workers-ai") return { rate: [0, 0], priced: true };
  const p = prices(env);
  const exact = p[`${provider}:${model}`.toLowerCase()] ?? p[`${provider}:*`.toLowerCase()];
  return exact ? { rate: exact, priced: true } : { rate: ESTIMATE, priced: false };
}

export function costMicroUsd(provider: string, model: string, tokensIn: number, tokensOut: number, env: Env = process.env): number {
  const { rate } = price(provider, model, env);
  return Math.round(tokensIn * rate[0] + tokensOut * rate[1]);         // (tokens / 1e6) * usd * 1e6
}

export async function recordCall(db: Db, call: { userId: number; target: Target; job: Job; tokensIn: number; tokensOut: number; fallback: boolean }, now = new Date()) {
  const day = dayOf(now);
  const tokensIn = Math.max(0, Math.round(call.tokensIn));
  const tokensOut = Math.max(0, Math.round(call.tokensOut));
  const cost = costMicroUsd(call.target.provider, call.target.model, tokensIn, tokensOut);
  await db.insert(usageDaily).values({ userId: call.userId, day, aiCalls: 1, tokensIn, tokensOut })
    .onConflictDoUpdate({
      target: [usageDaily.userId, usageDaily.day],
      set: { aiCalls: sql`${usageDaily.aiCalls} + 1`, tokensIn: sql`${usageDaily.tokensIn} + ${tokensIn}`, tokensOut: sql`${usageDaily.tokensOut} + ${tokensOut}` },
    });
  await db.insert(aiUsage).values({
    day, provider: call.target.provider, model: call.target.model, job: call.job, calls: 1, fallbacks: call.fallback ? 1 : 0,
    tokensIn, tokensOut, costMicroUsd: cost,
  }).onConflictDoUpdate({
    target: [aiUsage.day, aiUsage.provider, aiUsage.model, aiUsage.job],
    set: {
      calls: sql`${aiUsage.calls} + 1`, fallbacks: sql`${aiUsage.fallbacks} + ${call.fallback ? 1 : 0}`,
      tokensIn: sql`${aiUsage.tokensIn} + ${tokensIn}`, tokensOut: sql`${aiUsage.tokensOut} + ${tokensOut}`,
      costMicroUsd: sql`${aiUsage.costMicroUsd} + ${cost}`,
    },
  });
}

export async function usedToday(db: Db, userId: number, now = new Date()) {
  const row = await db.select().from(usageDaily).where(and(eq(usageDaily.userId, userId), eq(usageDaily.day, dayOf(now)))).get();
  return { ai_calls: row?.aiCalls ?? 0 };
}

export async function usedThisMonth(db: Db, userId: number, now = new Date()) {
  const row = await db.select({
    calls: sql<number>`coalesce(sum(${usageDaily.aiCalls}), 0)`,
    tokens: sql<number>`coalesce(sum(${usageDaily.tokensIn} + ${usageDaily.tokensOut}), 0)`,
  }).from(usageDaily).where(and(eq(usageDaily.userId, userId), like(usageDaily.day, `${monthOf(now)}-%`))).get();
  return { calls: Number(row?.calls ?? 0), tokens: Number(row?.tokens ?? 0) };
}

export async function usageHistory(db: Db, userId: number, days = 30, now = new Date()) {
  const since = dayOf(new Date(now.getTime() - (days - 1) * 86_400_000));
  const rows = await db.select().from(usageDaily).where(and(eq(usageDaily.userId, userId), gte(usageDaily.day, since))).orderBy(usageDaily.day).all();
  return rows.map((r) => ({ day: r.day, ai_calls: r.aiCalls, tokens: r.tokensIn + r.tokensOut }));
}

function nextDay(now: Date) { return nowIso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))); }
function nextMonth(now: Date) { return nowIso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))); }

/** 429 plan_limit once today's calls or this month's tokens are used up (the owner has no quota). */
export async function checkQuota(db: Db, who: { id: number; owner: boolean; tier: Tier }, now = new Date()) {
  if (who.owner) return;
  const lim = limits(who.tier);
  const today = await usedToday(db, who.id, now);
  if (today.ai_calls >= lim.ai_calls_day) {
    throw planLimit(who.tier, "ai_calls_day", today.ai_calls, lim.ai_calls_day,
      `You've used today's ${lim.ai_calls_day} AI calls. They come back at midnight (UTC), or upgrade for more.`,
      { status: 429, resetsAt: nextDay(now) });
  }
  const month = await usedThisMonth(db, who.id, now);
  if (month.tokens >= lim.tokens_month) {
    throw planLimit(who.tier, "tokens_month", month.tokens, lim.tokens_month,
      "You've used this month's AI allowance. It renews on the 1st, or upgrade for more.", { status: 429, resetsAt: nextMonth(now) });
  }
}

/** The hard ceiling on the daily cap: AI_DAILY_CAP_MAX_USD (US dollars), default 20. */
export function capCeilingUsd(env: Env = process.env): number {
  const n = Number((env.AI_DAILY_CAP_MAX_USD ?? "").trim() || NaN);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP_CEILING_USD;
}

/** The cap in US dollars: never off, never above the ceiling (an old "off" now means the ceiling). */
export async function capUsd(db: Db, env: Env = process.env): Promise<number> {
  const ceiling = capCeilingUsd(env);
  const row = await db.select().from(appSettings).where(eq(appSettings.key, CAP_KEY)).get();
  const raw = (row?.value ?? env.AI_DAILY_CAP_USD ?? String(DEFAULT_CAP_USD)).trim().toLowerCase();
  if (!raw || raw === "off" || raw === "none") return ceiling;
  const n = Number(raw);
  return Math.min(Number.isFinite(n) && n >= 0 ? n : DEFAULT_CAP_USD, ceiling);
}

export async function setCapUsd(db: Db, usd: number): Promise<void> {
  const value = String(usd);
  await db.insert(appSettings).values({ key: CAP_KEY, value, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: nowIso() } });
}

/** Today's API spend so far (Workers AI counts 0), in US dollars. */
export async function spendToday(db: Db, now = new Date()): Promise<number> {
  const row = await db.select({ micro: sql<number>`coalesce(sum(${aiUsage.costMicroUsd}), 0)` }).from(aiUsage).where(eq(aiUsage.day, dayOf(now))).get();
  return Number(row?.micro ?? 0) / 1e6;
}

export async function isCapped(db: Db, now = new Date()): Promise<boolean> {
  return (await spendToday(db, now)) >= (await capUsd(db));
}

/** Admin -> AI: spend, the cap, per model and per day. */
export async function costReport(db: Db, days = 30, now = new Date()) {
  const since = dayOf(new Date(now.getTime() - (days - 1) * 86_400_000));
  const rows = await db.select().from(aiUsage).where(gte(aiUsage.day, since)).all();
  const byModel = new Map<string, { provider: string; model: string; calls: number; fallbacks: number; tokens_in: number; tokens_out: number; cost_usd: number; priced: boolean }>();
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.provider}:${r.model}`;
    const m = byModel.get(key) ?? { provider: r.provider, model: r.model, calls: 0, fallbacks: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, priced: price(r.provider, r.model).priced };
    m.calls += r.calls; m.fallbacks += r.fallbacks; m.tokens_in += r.tokensIn; m.tokens_out += r.tokensOut; m.cost_usd += r.costMicroUsd / 1e6;
    byModel.set(key, m);
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.costMicroUsd / 1e6);
  }
  return {
    days,
    today_usd: await spendToday(db, now),
    cap_usd: await capUsd(db),
    cap_max_usd: capCeilingUsd(),
    capped: await isCapped(db, now),
    total_usd: [...byDay.values()].reduce((a, b) => a + b, 0),
    models: [...byModel.values()].sort((a, b) => b.cost_usd - a.cost_usd),
    by_day: [...byDay].sort().map(([day, usd]) => ({ day, usd })),
  };
}
