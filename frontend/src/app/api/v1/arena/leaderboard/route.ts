// Arena boards: each player's best won battle on a topic + difficulty (+ document), or this week's (global).
import { requireUser } from "@/server/context";
import * as A from "@/server/game/arenaApi";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => A.leaderboard(ctx, await requireUser(req, ctx), new URL(req.url).searchParams));
