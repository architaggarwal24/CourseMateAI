// Best finished run per player: on one document (all time) or global (this week).
import { requireUser } from "@/server/context";
import * as A from "@/server/game/arena-api";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => A.runLeaderboard(ctx, await requireUser(req, ctx), new URL(req.url).searchParams));
