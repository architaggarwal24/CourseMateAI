// Your hero: PUT { look } (game/build.ts saveLook).
import { saveLook } from "@/server/game/build";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const PUT = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `hero-look:${p.id}`, 60, 60);
  const body = await readJson(req);
  return saveLook(ctx, p.id, body.look);
});
