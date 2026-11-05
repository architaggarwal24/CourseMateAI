// The shop: every item with its price, lock and whether the player owns or wears it.
import { requirePlayer } from "@/server/game/player";
import { shopState } from "@/server/game/shop";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => shopState(ctx, await requirePlayer(req, ctx)));
