// Two worlds, Stage 5: this week's invasion on a document (?session_id=): ready, the invader, its concepts, repelled.
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  return A.invasionInfo(ctx, u, new URL(req.url).searchParams.get("session_id"));
});
