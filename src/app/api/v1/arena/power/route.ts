// The arena hub's Stage 6 view: power level, Boss Rush (open after 3 creatures hunted), bests, a run in progress.
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  return A.gauntletOverview(ctx, u, new URL(req.url).searchParams.get("session_id"));
});
