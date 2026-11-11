// The forge: POST { item } (game/forge.ts upgrade).
import { ownedStyles } from "@/server/game/build";
import { upgrade } from "@/server/game/forge";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `forge-upgrade:${p.id}`, 60, 60);
  const body = await readJson(req);
  return upgrade(ctx, p.id, body.item, await ownedStyles(ctx, p.id));
});
