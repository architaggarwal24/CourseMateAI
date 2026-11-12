// Boss Rush / Survival: give up (chests already won are kept; a fight in progress is lost).
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  return A.abandonGauntlet(ctx, await playerOf(req, ctx, u), id);
});
