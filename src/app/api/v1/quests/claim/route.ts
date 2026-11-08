// Break a finished scroll's seal: paid once (a hunt also finds the creature's lost page). Daily quests keep
// their own claim (/daily-quests/claim).
import { requirePlayer } from "@/server/game/player";
import { claimScroll } from "@/server/game/scrolls";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `quest-claim:${p.id}`, 30, 60);
  return claimScroll(ctx, p, (await readJson(req)).id);
});
