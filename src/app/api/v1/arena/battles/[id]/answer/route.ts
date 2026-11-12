// Grade an answer on the server and resolve the turn. The first answer to a question is final.
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-answer:${u.id}`, 120, 60);
  return A.answer(ctx, u, await playerOf(req, ctx, u), id, await readJson(req));
});
