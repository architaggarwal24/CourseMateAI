// Shop: equip.
import { requirePlayer } from "@/server/game/player";
import { equip } from "@/server/game/shop";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `shop-equip:${p.id}`, 120, 60);
  const b = await readJson(req);
  return equip(ctx, p, String(b.item_id ?? ""));
});
