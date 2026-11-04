// Use an invite code: the user's plan becomes the code's.
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { redeemInvite } from "@/server/invites";
import { usageSummary } from "@/server/plans";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `redeem:${u.id}`, 10, 3600);
  const { code } = await readJson<{ code?: string }>(req);
  await redeemInvite(ctx.db, u.id, String(code ?? ""));
  return usageSummary(ctx.db, { id: u.id, owner: u.owner });
});
