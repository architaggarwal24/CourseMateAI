// Start a battle (or resume the one running on this document with the same topic and difficulty). Never an answer.
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-create:${u.id}`, 10, 60);
  return A.createBattle(ctx, u, await playerOf(req, ctx, u), await readJson(req));
});
