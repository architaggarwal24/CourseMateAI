// Shop: purchase.
import { requirePlayer } from "@/server/game/player";
import { purchase } from "@/server/game/shop";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `shop-purchase:${p.id}`, 60, 60);
  const b = await readJson(req);
  return purchase(ctx, p, String(b.item_id ?? ""));
});
