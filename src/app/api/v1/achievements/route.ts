// All achievements, with the player's unlocks and the stats they count.
import { achievements } from "@/server/game/avatar";
import { optionalPlayer } from "@/server/game/player";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => achievements(ctx, (await optionalPlayer(req, ctx))?.id ?? null));
