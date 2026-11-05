// Give up the run (a fight in progress is lost); it pays for the depth reached.
import { requireUser } from "@/server/context";
import { abandon } from "@/server/game/expedition";
import { playerOf } from "@/server/game/player";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `run-abandon:${u.id}`, 30, 60);
  return abandon(ctx, await playerOf(req, ctx, u), id);
});
