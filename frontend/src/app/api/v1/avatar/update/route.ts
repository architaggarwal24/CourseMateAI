// Wear or take off items by slot (ownership enforced; anything not allowed is skipped).
import { updateAvatar } from "@/server/game/avatar";
import { requirePlayer } from "@/server/game/player";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const p = await requirePlayer(req, ctx);
  await rateLimit(ctx.db, `avatar:${p.id}`, 60, 60);
  return updateAvatar(ctx, p.id, (await readJson(req)).equipped);
});
