// The forge: your gear's tiers and XP bars, your materials (game/forge.ts).
import { ownedStyles } from "@/server/game/build";
import { forgeView } from "@/server/game/forge";
import { requirePlayer } from "@/server/game/player";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  return forgeView(ctx, p.id, await ownedStyles(ctx, p.id));
});
