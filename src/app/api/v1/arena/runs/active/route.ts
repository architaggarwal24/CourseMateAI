// The run in progress (on this document, or the latest playable one), or null.
import { requireUser } from "@/server/context";
import * as A from "@/server/game/arena-api";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => A.activeRun(ctx, await requireUser(req, ctx), new URL(req.url).searchParams.get("session_id")));
