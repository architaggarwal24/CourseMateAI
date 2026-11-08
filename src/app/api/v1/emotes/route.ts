// Victory emotes: every one and whether the player has it (Stage A2).
import { emotes } from "@/server/game/emotes";
import { requirePlayer } from "@/server/game/player";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => emotes(ctx, (await requirePlayer(req, ctx)).id));
