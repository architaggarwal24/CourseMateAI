// Your hero: PUT { build } (game/build.ts saveBuild).
import { saveBuild } from "@/server/game/build";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const PUT = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `hero-build:${p.id}`, 60, 60);
  const body = await readJson(req);
  return saveBuild(ctx, p.id, body.build);
});
