// The daily chest (Stage R3): is today's chest still closed, and the streak.
import { chestState } from "@/server/game/chest";
import { requirePlayer } from "@/server/game/player";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => chestState(ctx, await requirePlayer(req, ctx)));
