// Start a Boss Rush or a Survival. Body: {kind: "rush" | "survival", session_id, topic}.
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-gauntlet:${u.id}`, 10, 60);
  return A.createGauntlet(ctx, u, await playerOf(req, ctx, u), await readJson(req));
});
