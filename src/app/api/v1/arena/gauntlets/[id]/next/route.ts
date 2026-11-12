// Boss Rush / Survival: the next fight, after a win (hearts carried over).
import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-gauntlet-next:${u.id}`, 20, 60);
  return A.nextGauntletFight(ctx, u, id);
});
