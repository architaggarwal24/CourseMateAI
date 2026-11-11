// Your hero: POST { item } (game/build.ts buy).
import { buy } from "@/server/game/build";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `hero-buy:${p.id}`, 60, 60);
  const body = await readJson(req);
  return buy(ctx, p.id, body.item);
});
