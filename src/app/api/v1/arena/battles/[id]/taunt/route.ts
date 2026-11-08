// Battle: taunt the boss (once a fight): it rages, your ultimate charges, the win pays more.
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import { taunt } from "@/server/game/arena";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-taunt:${u.id}`, 30, 60);
  return taunt(ctx, await playerOf(req, ctx, u), id);
});
