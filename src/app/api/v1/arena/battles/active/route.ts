// The battle in progress (on this document, or the latest one): how a refresh finds its fight again.
import { requireUser } from "@/server/context";
import * as A from "@/server/game/arenaApi";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => A.activeBattle(ctx, await requireUser(req, ctx), new URL(req.url).searchParams.get("session_id")));
