// The forge: POST { pet } (game/forge.ts saddle).
import { ownedStyles } from "@/server/game/build";
import { saddle } from "@/server/game/forge";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `forge-saddle:${p.id}`, 60, 60);
  const body = await readJson(req);
  return saddle(ctx, p.id, body.pet, await ownedStyles(ctx, p.id));
});
