// Battle: ultimate.
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import { useUltimate } from "@/server/game/arena";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-ultimate:${u.id}`, 30, 60);
  return useUltimate(ctx, await playerOf(req, ctx, u), id);
});
