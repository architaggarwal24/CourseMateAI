import { setUserPlan } from "@/server/admin";
import { requireAdmin } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api, intParam } from "@/server/route";

export const dynamic = "force-dynamic";

/** { tier, days } - days empty/null = no end. */
export const PUT = api<{ id: string }>(async (req, ctx, { id }) => {
  const actor = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  const body = await readJson<{ tier?: unknown; days?: unknown }>(req);
  return setUserPlan(ctx, actor, intParam(id), body.tier, body.days);
});

/** Back to Free. */
export const DELETE = api<{ id: string }>(async (req, ctx, { id }) => {
  const actor = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  return setUserPlan(ctx, actor, intParam(id), null, null);
});
