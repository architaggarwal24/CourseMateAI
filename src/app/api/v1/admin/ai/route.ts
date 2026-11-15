// Admin -> AI: what the server's AI has cost (per model, per day), today's spend and the daily cap, the plan, user
// and free-tool budgets (ai/budget.ts) with today's spend against them, and which model answers what.
import { effectiveEnv } from "@/server/ai/config";
import { route } from "@/server/ai/models";
import type { Db } from "@/server/db";
import { capCeilingUsd, costReport, setCapUsd } from "@/server/ai/usage";
import { budgetToday, checkBudgets, loadLimits, saveBudgets } from "@/server/ai/budget";
import { requireAdmin } from "@/server/context";
import { HttpError, rateLimit, readJson } from "@/server/http";
import { TIERS } from "@/server/account/plans";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

/** Which model answers what, with the models admins saved for everyone. */
async function routes(db: Db) {
  const env = await effectiveEnv(db);
  return Object.fromEntries(TIERS.map((t) => [t, {
    small: route(t, "small", { env }).map((x) => `${x.provider}:${x.model}`),
    strong: route(t, "strong", { env }).map((x) => `${x.provider}:${x.model}`),
  }]));
}

async function report(db: Db, days: number, canEdit: boolean) {
  const [cost, limits, today, r] = await Promise.all([costReport(db, days), loadLimits(db), budgetToday(db), routes(db)]);
  return { ...cost, budgets: limits.budgets, budget_today: today, routes: r, can_edit: canEdit };
}

export const GET = api(async (req, ctx) => {
  const actor = await requireAdmin(req, ctx);
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 30) || 30));
  return report(ctx.db, days, actor.owner);
});

/**
 * { cap_usd?: number, budgets?: Budgets } - the owner only. The cap: 0 up to the hard ceiling (AI_DAILY_CAP_MAX_USD,
 * default 20), never off. Each budget: 0 up to the same ceiling, or null for no limit at that level.
 */
export const PUT = api(async (req, ctx) => {
  const actor = await requireAdmin(req, ctx);
  if (!actor.owner) throw new HttpError(403, "owner_only", "Only the owner can change the AI spend cap and budgets.");
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  const body = await readJson<{ cap_usd?: unknown; budgets?: unknown }>(req);
  if (body.cap_usd === undefined && body.budgets === undefined) {
    throw new HttpError(400, "invalid_cap", "Send cap_usd, budgets or both.", null, { field: "cap_usd" });
  }
  const ceiling = capCeilingUsd();
  const { cap_usd } = body;
  if (cap_usd !== undefined && (typeof cap_usd !== "number" || !Number.isFinite(cap_usd) || cap_usd < 0 || cap_usd > ceiling)) {
    throw new HttpError(400, "invalid_cap", `The cap is a number of US dollars, from 0 to ${ceiling}. Raise AI_DAILY_CAP_MAX_USD in the Cloudflare dashboard to go higher.`, null, { field: "cap_usd", max: ceiling });
  }
  const budgets = body.budgets === undefined ? undefined : checkBudgets(body.budgets);     // checked before anything is saved
  if (typeof cap_usd === "number") await setCapUsd(ctx.db, cap_usd);
  if (budgets) await saveBudgets(ctx.db, budgets);
  return report(ctx.db, 30, true);
});
