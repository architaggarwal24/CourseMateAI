// Today's quests (made for the player's level the first time they're asked for today, in their time zone).
import { requirePlayer } from "@/server/game/player";
import { dailyQuestsFor } from "@/server/game/progression";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => ({ quests: await dailyQuestsFor(ctx, await requirePlayer(req, ctx)) }));
