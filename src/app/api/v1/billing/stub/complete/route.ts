// The test provider's "payment" (PAYMENTS_PROVIDER=stub only).
import { stubComplete } from "@/server/billing";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `billing-stub:${u.id}`, 20, 3600);
  return stubComplete(ctx, u, (await readJson(req)).subscription_id);
});
