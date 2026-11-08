// Open today's chest: coins (more with a streak), often a potion, now and then a skin. Once a day (409 chest_opened).
import { openChest } from "@/server/game/chest";
import { requirePlayer } from "@/server/game/player";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `chest:${p.id}`, 20, 60);
  return openChest(ctx, p);
});
