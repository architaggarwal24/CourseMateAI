// Level, XP, coins and the avatar (a guest gets the starting values).
import { profile } from "@/server/game/avatar";
import { optionalPlayer } from "@/server/game/player";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => profile(ctx, (await optionalPlayer(req, ctx))?.id ?? null));
