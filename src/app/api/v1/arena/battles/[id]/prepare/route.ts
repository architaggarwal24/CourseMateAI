// Battle: write a deferred battle's questions (Stage 5: they are written while the player picks a champion).
import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";
import * as A from "@/server/game/arena-api";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-prepare:${u.id}`, 20, 60);
  return A.prepareBattle(ctx, u, id);
});
