import { grantGame } from "@/server/account/admin";
import { requireAdmin } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api, intParam } from "@/server/route";

export const dynamic = "force-dynamic";

/**
 * { xp, coins, reason, mode } - the owner only. mode "give" (default): a minus takes away (never below zero);
 * "set": make them exactly these amounts (an empty one stays as it is).
 */
export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const actor = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  const body = await readJson<{ xp?: unknown; coins?: unknown; reason?: unknown; mode?: unknown }>(req);
  return grantGame(ctx, actor, intParam(id), body.xp, body.coins, body.reason, body.mode);
});
