// Admin -> AI: what the server's AI has cost (per model, per day), today's spend and the daily cap, and which
// model answers what.
import { route } from "@/server/ai/models";
import { costReport, setCapUsd } from "@/server/ai/usage";
import { requireAdmin } from "@/server/context";
import { HttpError, rateLimit, readJson } from "@/server/http";
import { TIERS } from "@/server/plans";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

function routes() {
  return Object.fromEntries(TIERS.map((t) => [t, {
    small: route(t, "small").map((x) => `${x.provider}:${x.model}`),
    strong: route(t, "strong").map((x) => `${x.provider}:${x.model}`),
  }]));
}

export const GET = api(async (req, ctx) => {
  await requireAdmin(req, ctx);
  const days = Math.min(90, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? 30) || 30));
  return { ...(await costReport(ctx.db, days)), routes: routes() };
});

/** { cap_usd: number | null } - null = no cap. */
export const PUT = api(async (req, ctx) => {
  const actor = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  const { cap_usd } = await readJson<{ cap_usd?: unknown }>(req);
  if (cap_usd !== null && (typeof cap_usd !== "number" || !Number.isFinite(cap_usd) || cap_usd < 0 || cap_usd > 10_000)) {
    throw new HttpError(400, "invalid_cap", "The cap is a number of US dollars (0 to 10000), or empty for no cap.", null, { field: "cap_usd" });
  }
  await setCapUsd(ctx.db, cap_usd as number | null);
  return { ...(await costReport(ctx.db, 30)), routes: routes() };
});
