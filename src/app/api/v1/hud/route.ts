// Everything the header and sidebar show: progress, today's quests, the shop, buffs and potions.
import { hud } from "@/server/game/avatar";
import { optionalPlayer } from "@/server/game/player";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => hud(ctx, await optionalPlayer(req, ctx)));
