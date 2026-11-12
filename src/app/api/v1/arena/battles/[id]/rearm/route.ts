// Battle: before its first question, fight as the champion picked on the character select screen.
import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-rearm:${u.id}`, 30, 60);
  return A.rearmBattle(ctx, u, id);
});
