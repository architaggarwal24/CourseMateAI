// Battle: spells (only what the player owns or can pay for with Focus).
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { castSpell } from "@/server/game/arena";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-spells:${u.id}`, 60, 60);
  return castSpell(ctx, await playerOf(req, ctx, u), id, (await readJson(req)).spell);
});
