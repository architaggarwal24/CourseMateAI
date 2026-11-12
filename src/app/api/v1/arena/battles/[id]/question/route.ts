// The next question for a move (strike - the default - | jab | heavy | guard): asking again returns the same one.
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-question:${u.id}`, 120, 60);
  return A.question(ctx, u, await playerOf(req, ctx, u), id, new URL(req.url).searchParams.get("move"));
});
