// Move to a reachable node: a fight starts a battle; rest / shop leave a choice; treasure gives a relic.
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `run-travel:${u.id}`, 30, 60);
  return A.travel(ctx, u, id, await readJson(req));
});
