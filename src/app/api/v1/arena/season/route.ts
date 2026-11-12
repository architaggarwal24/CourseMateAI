// Two worlds, Stage 7: the season on now and its limited boss on a document (?session_id=; admins: ?preview=<season>).
import { requireUser } from "@/server/context";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  const q = new URL(req.url).searchParams;
  return A.seasonInfo(ctx, u, q.get("session_id"), q.get("preview"));
});
