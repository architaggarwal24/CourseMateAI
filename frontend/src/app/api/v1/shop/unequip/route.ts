// Shop: unequip.
import { requirePlayer } from "@/server/game/player";
import { unequip } from "@/server/game/shop";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `shop-unequip:${p.id}`, 120, 60);
  const b = await readJson(req);
  return unequip(ctx, p, String(b.slot ?? ""));
});
