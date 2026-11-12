// Battle: CONTINUE after a knock-down, with a health potion or coins (up to 3 a fight). Body: {with: "potion" | "coins"}.
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { continueBattle } from "@/server/game/arena";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-continue:${u.id}`, 20, 60);
  const body = await readJson(req) as { with?: unknown };
  return continueBattle(ctx, await playerOf(req, ctx, u), id, body.with);
});
