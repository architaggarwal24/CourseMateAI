// The unlock ceremony was seen: its reward is paid once (a second call pays nothing).
import { celebrateChampion } from "@/server/game/avatar";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `champion:${p.id}`, 60, 60);
  return celebrateChampion(ctx, p.id, await readJson(req));
});
