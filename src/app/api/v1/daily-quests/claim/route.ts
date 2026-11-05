// Claim a completed quest: marked claimed and paid as one ledger event, so a repeat can't pay again.
import { requirePlayer } from "@/server/game/player";
import { claimQuest } from "@/server/game/progression";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `quest-claim:${p.id}`, 30, 60);
  return claimQuest(ctx, p, String((await readJson(req)).quest_type ?? ""));
});
