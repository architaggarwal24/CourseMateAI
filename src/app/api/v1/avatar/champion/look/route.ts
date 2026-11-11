// Build your own: PUT { champion_id, look } saves how that champion looks; look: null goes back to its own look.
import { saveChampionLook } from "@/server/game/avatar";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const PUT = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `champion-look:${p.id}`, 60, 60);
  return saveChampionLook(ctx, p.id, await readJson(req));
});
