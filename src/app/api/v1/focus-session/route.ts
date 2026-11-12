// Two worlds, Stage 6: a focus session finished in Study: +20 Insight (+10 XP), four a day.
import { focusSession } from "@/server/game/focus";
import { requirePlayer } from "@/server/game/player";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `focus:${p.id}`, 10, 60);
  return focusSession(ctx, p);
});
