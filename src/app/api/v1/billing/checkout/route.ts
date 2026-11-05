// Start a subscription for a plan and period (the browser then opens Razorpay Checkout).
import { checkout } from "@/server/billing";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { idempotent } from "@/server/idempotency";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `billing-checkout:${u.id}`, 10, 3600);
  return idempotent(req, ctx.db, `billing-checkout:${u.id}`, async () => {
    const b = await readJson(req);
    return checkout(ctx, u, b.tier, b.period);
  });
});
