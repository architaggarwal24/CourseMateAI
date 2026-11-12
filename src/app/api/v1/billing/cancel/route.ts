// Cancel at the end of the paid period.
import { cancel } from "@/server/account/billing";
import { requireUser } from "@/server/context";
import { rateLimit } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `billing-cancel:${u.id}`, 10, 3600);
  return cancel(ctx, u);
});
