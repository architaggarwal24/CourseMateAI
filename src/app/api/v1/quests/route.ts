// The quest board (Stage Q1): today's quests, this week's trials, Bestiary hunts and the champion's story, as scrolls.
import { requirePlayer } from "@/server/game/player";
import { questBoard } from "@/server/game/scrolls";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => questBoard(ctx, await requirePlayer(req, ctx)));
