// The concepts of this document the player keeps missing, weakest first (what a Nemesis is made of).
import { requireUser } from "@/server/context";
import * as A from "@/server/game/arena-api";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = api(async (req, ctx) => {
  const q = new URL(req.url).searchParams;
  return A.weak(ctx, await requireUser(req, ctx), q.get("session_id") ?? "", Number(q.get("limit") ?? 8));
});
