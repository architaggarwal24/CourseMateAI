// Battle: items (only what the player owns or can pay for with Focus).
import { requireUser } from "@/server/context";
import { playerOf } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";
import { useItem } from "@/server/game/arena";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `arena-items:${u.id}`, 60, 60);
  return useItem(ctx, await playerOf(req, ctx, u), id, (await readJson(req)).item);
});
