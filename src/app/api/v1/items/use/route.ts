// Use a potion from the inventory: its effect applies now.
import { requirePlayer } from "@/server/game/player";
import { useItem } from "@/server/game/shop";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `items-use:${p.id}`, 60, 60);
  return useItem(ctx, p, String((await readJson(req)).item_id ?? ""));
});
