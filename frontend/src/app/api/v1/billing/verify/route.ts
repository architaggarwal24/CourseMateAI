// Checkout's success handler: the signature is checked and the plan switches on.
import { verify } from "@/server/billing";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `billing-verify:${u.id}`, 20, 3600);
  const b = await readJson(req);
  return verify(ctx, u, b.razorpay_payment_id, b.razorpay_subscription_id, b.razorpay_signature);
});
