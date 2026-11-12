import { requireAdmin } from "@/server/context";
import { HttpError, rateLimit } from "@/server/http";
import { revokeInvite } from "@/server/account/invites";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const DELETE = api<{ code: string }>(async (req, ctx, { code }) => {
  const actor = await requireAdmin(req, ctx);
  await rateLimit(ctx.db, `admin:${actor.id}`, 120, 60);
  if (!(await revokeInvite(ctx.db, decodeURIComponent(code)))) throw new HttpError(404, "invite_not_found", "There's no such code.");
  return { ok: true };
});
