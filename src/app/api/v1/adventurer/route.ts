// Two worlds, Stage 7: your Adventurer card (champion, level, power, best Survival, Boss Rush, Bestiary, achievements).
import { adventurerCard } from "@/server/game/adventurer";
import { requirePlayer } from "@/server/game/player";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => adventurerCard(ctx, (await requirePlayer(req, ctx)).id));
