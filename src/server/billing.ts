// Paid plans through subscriptions (Stage 4.6; port of backend/services/billing.py). Off unless PAYMENTS_ENABLED=1.
// The provider is Razorpay (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET, plan ids in
// RAZORPAY_PLAN_IDS_JSON, e.g. {"scholar:month": "plan_..."}) - or, only with PAYMENTS_PROVIDER=stub, a stub that
// "pays" at once, for trying the whole flow without keys or money.
//   checkout  a subscription at the provider; the browser opens Razorpay Checkout with its id
//   verify    Checkout's signature = HMAC-SHA256(payment_id|subscription_id, key secret): the plan is on at once
//   webhook   X-Razorpay-Signature = HMAC-SHA256(raw body, webhook secret); each event handled once
//   cancel    at the end of the paid period (the plan stays until then)
// The plan (user_plans, source 'subscription'): live -> until the period ends + GRACE_DAYS; cancelled /
// completed -> until the period ends; halted / paused / expired -> back to Free now.
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { CurrentUser, RequestContext } from "./context";
import { paymentEvents, subscriptions, userPlans } from "./db/schema";
import { HttpError } from "./http";
import { PLANS, TIER_NAMES, forgetTier, type Tier } from "./plans";
import { notePlanChange, planState } from "./planNotices";

export const GRACE_DAYS = 3;
const PERIOD_DAYS: Record<string, number> = { month: 30, year: 365 };
const PAID_TIERS = ["scholar", "sage", "archmage"];
const LIVE = ["authenticated", "active", "pending"];
const ENDED_AT_PERIOD_END = ["cancelled", "completed"];
const ENDED_NOW = ["halted", "paused", "expired"];
const API = "https://api.razorpay.com/v1";

type Env = Record<string, string | undefined>;
type Sub = typeof subscriptions.$inferSelect;
type Entity = { id?: string; status?: string; current_start?: number | null; current_end?: number | null; short_url?: string | null };
const iso = (d: Date | null) => (d ? d.toISOString().replace(/\.\d{3}Z$/, "Z") : null);
const fromUnix = (v: unknown) => (v ? new Date(Number(v) * 1000) : null);
const env = (e: Env, k: string) => (e[k] ?? "").trim();

export const paymentsOff = () => new HttpError(503, "payments_unavailable", "Payments aren't open yet. Plans come with invite codes for now.");

async function hmacHex(secret: string, message: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const data = typeof message === "string" ? new TextEncoder().encode(message) : message;
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, data))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export interface Provider {
  name: "razorpay" | "stub"; keyId: string;
  create(userId: number, tier: string, period: string): Promise<Entity>;
  fetch(id: string): Promise<Entity>;
  cancel(id: string, atCycleEnd?: boolean): Promise<Entity>;
  verifyCheckout(paymentId: string, subId: string, signature: string): Promise<boolean>;
  verifyWebhook(body: Uint8Array<ArrayBuffer>, signature: string): Promise<boolean>;
}

export function razorpay(keyId: string, secret: string, webhookSecret: string, planIds: Record<string, string>, fetchImpl: typeof fetch = fetch): Provider {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetchImpl(API + path, {
      method, headers: { authorization: `Basic ${btoa(`${keyId}:${secret}`)}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      console.warn(`[coursemate-billing] razorpay ${method} ${path} -> ${r.status}`);
      throw new HttpError(502, "payment_provider_error", "The payment provider didn't accept that. Please try again.", "retry");
    }
    return (await r.json()) as Entity;
  };
  return {
    name: "razorpay", keyId,
    create(userId, tier, period) {
      const plan = planIds[`${tier}:${period}`];
      if (!plan) throw new HttpError(400, "plan_not_on_sale", `${TIER_NAMES[tier as Tier]} (${period}ly) isn't on sale yet.`);
      return call("POST", "/subscriptions", { plan_id: plan, total_count: period === "month" ? 120 : 10, customer_notify: 1, notes: { user_id: String(userId), tier, period } });
    },
    fetch: (id) => call("GET", `/subscriptions/${id}`),
    cancel: (id, atCycleEnd = true) => call("POST", `/subscriptions/${id}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 }),
    verifyCheckout: async (paymentId, subId, signature) => safeEqual(await hmacHex(secret, `${paymentId}|${subId}`), signature || ""),
    verifyWebhook: async (body, signature) => !!webhookSecret && safeEqual(await hmacHex(webhookSecret, body), signature || ""),
  };
}

export const stub = (): Provider => ({
  name: "stub", keyId: "stub",
  create: async () => ({ id: `sub_stub_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`, status: "created", short_url: null }),
  fetch: async (id) => ({ id, status: "active", current_start: Math.floor(Date.now() / 1000), current_end: null }),
  cancel: async (id, atCycleEnd = true) => ({ id, status: atCycleEnd ? "active" : "cancelled" }),
  verifyCheckout: async (_p, _s, signature) => signature === "stub",
  verifyWebhook: async () => false,
});

let testProvider: Provider | null | undefined;
/** Tests choose the provider (undefined: from the environment). */
export function setProviderForTests(p: Provider | null | undefined) { testProvider = p; }

/** The provider in force, or null when payments are off (or Razorpay is chosen but has no keys). */
export function provider(e: Env = process.env): Provider | null {
  if (testProvider !== undefined) return testProvider;
  if (!["1", "true", "yes"].includes(env(e, "PAYMENTS_ENABLED").toLowerCase())) return null;
  if (env(e, "PAYMENTS_PROVIDER").toLowerCase() === "stub") return stub();
  const kid = env(e, "RAZORPAY_KEY_ID"), secret = env(e, "RAZORPAY_KEY_SECRET");
  if (!kid || !secret) { console.warn("[coursemate-billing] PAYMENTS_ENABLED is on but Razorpay keys are missing: payments stay off"); return null; }
  let plans: Record<string, string> = {};
  try { plans = JSON.parse(env(e, "RAZORPAY_PLAN_IDS_JSON") || "{}"); } catch { console.warn("[coursemate-billing] RAZORPAY_PLAN_IDS_JSON is not valid JSON"); }
  return razorpay(kid, secret, env(e, "RAZORPAY_WEBHOOK_SECRET"), plans);
}

export function publicSub(r: Sub) {
  return { id: r.id, provider: r.provider, tier: r.tier, tier_name: TIER_NAMES[r.tier as Tier], period: r.period, status: r.status,
           current_end: r.currentEnd, cancel_at_period_end: !!r.cancelAtPeriodEnd, short_url: r.shortUrl };
}

/** The subscription that matters now: a live one, else the latest. */
async function current(ctx: RequestContext, userId: number) {
  const rows = await ctx.db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt)).all();
  return rows.find((r) => LIVE.includes(r.status)) ?? rows[0] ?? null;
}

export async function status(ctx: RequestContext, user: CurrentUser) {
  const p = provider();
  const sub = await current(ctx, user.id);
  return { enabled: !!p, provider: p?.name ?? null, key_id: p?.keyId ?? null, subscription: sub ? publicSub(sub) : null };
}

export async function checkout(ctx: RequestContext, user: CurrentUser, tier: unknown, period: unknown) {
  const p = provider();
  if (!p) throw paymentsOff();
  if (typeof tier !== "string" || !PAID_TIERS.includes(tier) || typeof period !== "string" || !(period in PERIOD_DAYS)) {
    throw new HttpError(400, "invalid_input", "Choose Scholar, Sage or Archmage, monthly or yearly.");
  }
  const cur = await current(ctx, user.id);
  if (cur && ["active", "authenticated"].includes(cur.status) && cur.tier === tier && cur.period === period && !cur.cancelAtPeriodEnd) {
    throw new HttpError(409, "already_subscribed", `You're already on ${TIER_NAMES[cur.tier as Tier]}.`);
  }
  const sub = await p.create(user.id, tier, period);
  const now = iso(new Date())!;
  await ctx.db.insert(subscriptions).values({ id: sub.id!, userId: user.id, provider: p.name, tier, period, status: sub.status || "created", shortUrl: sub.short_url ?? null, createdAt: now, updatedAt: now });
  const plan = PLANS[tier as Tier];
  return {
    provider: p.name, subscription_id: sub.id, key_id: p.keyId, short_url: sub.short_url ?? null, tier, tier_name: TIER_NAMES[tier as Tier], period,
    currency: "INR", amount: period === "month" ? plan.price_month : plan.price_year, prefill: { name: user.row.name || "", email: user.row.email || "" },
  };
}

const subRow = (ctx: RequestContext, id: string) => ctx.db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();

export async function verify(ctx: RequestContext, user: CurrentUser, paymentId: unknown, subId: unknown, signature: unknown) {
  const p = provider();
  if (!p) throw paymentsOff();
  const row = typeof subId === "string" ? await subRow(ctx, subId) : undefined;
  if (!row || row.userId !== user.id) throw new HttpError(404, "subscription_not_found", "That subscription isn't yours.");
  if (!await p.verifyCheckout(String(paymentId ?? ""), row.id, String(signature ?? ""))) {
    throw new HttpError(400, "payment_unverified", "The payment couldn't be verified. If you were charged, it will show up shortly; otherwise try again.");
  }
  let entity: Entity;
  try { entity = await p.fetch(row.id); } catch { entity = { id: row.id, status: "authenticated" }; }
  if (!entity.status || entity.status === "created") entity.status = "authenticated";
  return update(ctx, p, row, entity);
}

export async function webhook(ctx: RequestContext, body: Uint8Array<ArrayBuffer>, signature: string, eventId: string) {
  const p = provider();
  if (!p || p.name !== "razorpay") throw paymentsOff();
  if (!await p.verifyWebhook(body, signature)) throw new HttpError(400, "webhook_unverified", "Bad signature.");
  let data: { event?: string; payload?: { subscription?: { entity?: Entity } } };
  try { data = JSON.parse(new TextDecoder().decode(body)); } catch { throw new HttpError(400, "invalid_input", "Bad JSON."); }
  const entity = data.payload?.subscription?.entity ?? {};
  const id = eventId || [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const took = await ctx.db.insert(paymentEvents).values({ id, provider: "razorpay", event: String(data.event ?? ""), subscriptionId: entity.id ?? null, receivedAt: iso(new Date())! })
    .onConflictDoNothing().returning({ id: paymentEvents.id }).all();
  if (!took.length) return { ok: true, duplicate: true };
  const row = await subRow(ctx, entity.id ?? "");
  if (!row) return { ok: true, ignored: true };
  await update(ctx, p, row, entity);
  return { ok: true };
}

export async function cancel(ctx: RequestContext, user: CurrentUser) {
  const p = provider();
  if (!p) throw paymentsOff();
  const row = await ctx.db.select().from(subscriptions).where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, LIVE))).orderBy(desc(subscriptions.createdAt)).get();
  if (!row) throw new HttpError(404, "subscription_not_found", "You have no subscription to cancel.");
  await p.cancel(row.id, true);
  await ctx.db.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: iso(new Date())! }).where(eq(subscriptions.id, row.id));
  return publicSub((await subRow(ctx, row.id))!);
}

export async function stubComplete(ctx: RequestContext, user: CurrentUser, subId: unknown) {
  const p = provider();
  if (!p || p.name !== "stub") throw new HttpError(404, "not_found", "Not found.");
  return verify(ctx, user, "pay_stub", subId, "stub");
}

async function update(ctx: RequestContext, p: Provider, row: Sub, entity: Entity) {
  const status = String(entity.status || row.status);
  const start = fromUnix(entity.current_start);
  let end = fromUnix(entity.current_end);
  const now = new Date();
  if (LIVE.includes(status) && !end && !row.currentEnd) end = new Date((start ?? now).getTime() + PERIOD_DAYS[row.period] * 86_400_000);
  await ctx.db.update(subscriptions).set({
    status, currentStart: start ? iso(start) : sql`${subscriptions.currentStart}`, currentEnd: end ? iso(end) : sql`${subscriptions.currentEnd}`,
    shortUrl: entity.short_url ?? sql`${subscriptions.shortUrl}`, updatedAt: iso(now)!,
  }).where(eq(subscriptions.id, row.id));
  const fresh = (await subRow(ctx, row.id))!;
  await syncPlan(ctx, fresh);
  if (status === "authenticated" || status === "active") await retireOthers(ctx, p, fresh);
  return publicSub(fresh);
}

async function syncPlan(ctx: RequestContext, row: Sub) {
  const now = new Date();
  const end = row.currentEnd ? new Date(row.currentEnd) : null;
  let expires: Date;
  if (LIVE.includes(row.status)) expires = new Date((end ?? now).getTime() + GRACE_DAYS * 86_400_000);
  else if (ENDED_AT_PERIOD_END.includes(row.status)) expires = new Date(Math.max((end ?? now).getTime(), now.getTime()));
  else if (ENDED_NOW.includes(row.status)) expires = now;
  else return;                                                  // created: nothing paid yet
  const plan = await ctx.db.select().from(userPlans).where(eq(userPlans.userId, row.userId)).get();
  if (!LIVE.includes(row.status) && plan && !(plan.source === "subscription" && plan.sourceRef === row.id)) return;  // an old one ending
  const t = iso(now)!;
  const before = await planState(ctx.db, row.userId, now);
  await ctx.db.insert(userPlans).values({ userId: row.userId, tier: row.tier as Tier, source: "subscription", sourceRef: row.id, startedAt: t, expiresAt: iso(expires), updatedAt: t })
    .onConflictDoUpdate({
      target: userPlans.userId,
      set: { tier: row.tier as Tier, source: "subscription", sourceRef: row.id, expiresAt: iso(expires), updatedAt: t,
             startedAt: sql`CASE WHEN ${userPlans.sourceRef} = ${row.id} THEN ${userPlans.startedAt} ELSE ${t} END` },
    });
  forgetTier(ctx.db, row.userId);
  await notePlanChange(ctx.db, row.userId, before, { source: "subscription" }, now);   // a higher plan: the thank-you window
}

/** Switching plans: the user's other live subscriptions are cancelled now (best effort). */
async function retireOthers(ctx: RequestContext, p: Provider, row: Sub) {
  const others = await ctx.db.select().from(subscriptions).where(and(eq(subscriptions.userId, row.userId), ne(subscriptions.id, row.id), inArray(subscriptions.status, LIVE))).all();
  for (const o of others) {
    try { await p.cancel(o.id, false); } catch { console.warn(`[coursemate-billing] could not cancel the previous subscription ${o.id}`); }
    await ctx.db.update(subscriptions).set({ status: "cancelled", updatedAt: iso(new Date())! }).where(eq(subscriptions.id, o.id));
  }
}
