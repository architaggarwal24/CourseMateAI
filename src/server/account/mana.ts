// Buying Mana (top-up packs for AI use, account/wallet.ts): Scholar, Sage and Archmage only, and only while payments
// are on (PAYMENTS_ENABLED). The flow is a one-time Razorpay Order:
//   checkout  an order for the pack at Razorpay (amount in paise), kept in mana_orders; the browser opens Checkout
//   verify    Checkout's signature (order_id|payment_id), then the order is fetched: once Razorpay says "paid" the
//             Mana is credited; until then "pending" (the order.paid webhook credits it when the payment lands)
//   stub      PAYMENTS_PROVIDER=stub "pays" at once, for trying the flow without keys or money
// Crediting is idempotent (wallet.ts): Checkout, verify and the webhook can all report the same payment safely.
import { and, eq } from "drizzle-orm";
import type { CurrentUser, RequestContext } from "../context";
import { manaOrders } from "../db/schema";
import { HttpError } from "../http";
import { paymentsOff, provider } from "./billing";
import { tierFor, TIER_NAMES } from "./plans";
import { creditOrder, MANA_MICRO_USD, packById, walletOf } from "./wallet";

export async function checkoutMana(ctx: RequestContext, user: CurrentUser, packId: unknown) {
  const p = provider();
  if (!p) throw paymentsOff();
  const pack = packById(packId);
  if (!pack) throw new HttpError(400, "invalid_pack", "Choose one of the Mana packs.");
  const tier = await tierFor(ctx.db, user);
  if (tier === "apprentice") {
    throw new HttpError(403, "mana_paid_plans_only", "Mana is for Scholar, Sage and Archmage. Upgrade your plan to top up.", "plans");
  }
  const order = await p.createOrder(user.id, pack.id, pack.inr * 100);
  if (!order.id) throw new HttpError(502, "payment_provider_error", "The payment provider didn't accept that. Please try again.", "retry");
  await ctx.db.insert(manaOrders).values({
    id: order.id, userId: user.id, provider: p.name, pack: pack.id, amountInr: pack.inr, manaMicro: pack.mana * MANA_MICRO_USD,
    status: "created", createdAt: new Date().toISOString(),
  });
  return {
    provider: p.name, order_id: order.id, key_id: p.keyId, pack: pack.id, name: pack.name, mana: pack.mana,
    amount: pack.inr, currency: "INR", tier_name: TIER_NAMES[tier], prefill: { name: user.row.name || "", email: user.row.email || "" },
  };
}

/** Checkout's success handler for a Mana order: the signature is checked, then the order's status at Razorpay. */
export async function verifyMana(ctx: RequestContext, user: CurrentUser, paymentId: unknown, orderId: unknown, signature: unknown) {
  const p = provider();
  if (!p) throw paymentsOff();
  const row = typeof orderId === "string"
    ? await ctx.db.select().from(manaOrders).where(and(eq(manaOrders.id, orderId), eq(manaOrders.userId, user.id))).get()
    : undefined;
  if (!row) throw new HttpError(404, "order_not_found", "That order isn't yours.");
  if (!await p.verifyOrder(String(paymentId ?? ""), row.id, String(signature ?? ""))) {
    throw new HttpError(400, "payment_unverified", "The payment couldn't be verified. If you were charged, your Mana will arrive shortly; otherwise try again.");
  }
  let status = "attempted";
  try { status = String((await p.fetchOrder(row.id)).status ?? status); } catch { /* the webhook credits it when it lands */ }
  if (status === "paid") await creditOrder(ctx.db, row.id, String(paymentId));
  const wallet = await walletOf(ctx.db, user.id);
  return { status: status === "paid" ? "paid" : "pending", mana: wallet.mana, pack: row.pack };
}

/** The test provider's "pay now" (PAYMENTS_PROVIDER=stub only). */
export async function stubCompleteMana(ctx: RequestContext, user: CurrentUser, orderId: unknown) {
  const p = provider();
  if (!p || p.name !== "stub") throw new HttpError(404, "not_found", "Not found.");
  return verifyMana(ctx, user, "pay_stub", orderId, "stub");
}
