// The forge: PUT { pet } (game/forge.ts setMount).
import { ownedStyles } from "@/server/game/build";
import { setMount } from "@/server/game/forge";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const PUT = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `forge-mount:${p.id}`, 60, 60);
  const body = await readJson(req);
  return setMount(ctx, p.id, body.pet ?? null, await ownedStyles(ctx, p.id));
});
