// Answer the pending choice: rest (heal | study), shop (buy | leave), relic offer (take | skip).
import { requireUser } from "@/server/context";
import { choose } from "@/server/game/expedition";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api<{ id: string }>(async (req, ctx, { id }) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `run-choose:${u.id}`, 60, 60);
  const b = await readJson(req);
  return { ok: true, ...(await choose(ctx, u.id, id, b.action, b.target)) };
});
