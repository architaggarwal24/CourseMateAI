// Admin -> AI: what the server's AI has cost (per model, per day), today's spend and the daily cap, and which
// model answers what.
import { effectiveEnv } from "@/server/ai/config";
import { route } from "@/server/ai/models";
import type { Db } from "@/server/db";
import { capCeilingUsd, costReport, setCapUsd } from "@/server/ai/usage";
import { requireAdmin } from "@/server/context";
import { HttpError, rateLimit, readJson } from "@/server/http";
import { TIERS } from "@/server/plans";
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

export const GET = api(async (req, ctx) => {
  const actor = await requireAdmin(req, ctx);
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 30) || 30));
  return { ...(await costReport(ctx.db, days)), routes: await routes(ctx.db), can_edit: actor.owner };
});

/** { cap_usd: number } - the owner only; 0 up to the hard ceiling (AI_DAILY_CAP_MAX_USD, default 20). Never off. */
export const PUT = api(async (req, ctx) => {
  const actor = await requireAdmin(req, ctx);
  if (!actor.owner) throw new HttpError(403, "owner_only", "Only the owner can change the AI spend cap.");
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  const { cap_usd } = await readJson<{ cap_usd?: unknown }>(req);
  const ceiling = capCeilingUsd();
  if (typeof cap_usd !== "number" || !Number.isFinite(cap_usd) || cap_usd < 0 || cap_usd > ceiling) {
    throw new HttpError(400, "invalid_cap", `The cap is a number of US dollars, from 0 to ${ceiling}. Raise AI_DAILY_CAP_MAX_USD in the Cloudflare dashboard to go higher.`, null, { field: "cap_usd", max: ceiling });
  }
  await setCapUsd(ctx.db, cap_usd);
  return { ...(await costReport(ctx.db, 30)), routes: await routes(ctx.db), can_edit: true };
});
