// Battle: pause (Esc in the Hero world): an open question's clock stops. Three a fight (409 no_pauses).
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import { pauseBattle } from "@/server/game/arena";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-pause:${u.id}`, 30, 60);
  return pauseBattle(ctx, await playerOf(req, ctx, u), id);
});
