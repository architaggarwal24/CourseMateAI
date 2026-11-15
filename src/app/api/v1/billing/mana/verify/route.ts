// Checkout's success handler for a Mana pack: the signature is checked and, once Razorpay has the payment, the Mana
// is credited (exactly once, however often this is called).
import { verifyMana } from "@/server/account/mana";
import { requireUser } from "@/server/context";
import { rateLimit, readJson } from "@/server/http";
import { api } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = api(async (req, ctx) => {
  const u = await requireUser(req, ctx);
  await rateLimit(ctx.db, `mana-verify:${u.id}`, 20, 3600);
  const b = await readJson(req);
  return verifyMana(ctx, u, b.razorpay_payment_id, b.razorpay_order_id, b.razorpay_signature);
});
