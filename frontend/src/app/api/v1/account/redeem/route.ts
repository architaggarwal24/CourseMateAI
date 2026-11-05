// Use an invite code: the user's plan becomes the code's.
import { accountUsage } from "@/server/account-usage";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { redeemInvite } from "@/server/invites";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `redeem:${u.id}`, 10, 3600);
  const { code } = await readJson<{ code?: string }>(req);
  await redeemInvite(ctx.db, u.id, String(code ?? ""));
  return accountUsage(ctx, u);
});
