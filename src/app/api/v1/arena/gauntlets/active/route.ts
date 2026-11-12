// The Boss Rush / Survival in progress (on a document, or the latest).
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  return A.activeGauntlet(ctx, u, new URL(req.url).searchParams.get("session_id"));
});
