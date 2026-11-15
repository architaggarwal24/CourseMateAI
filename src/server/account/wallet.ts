// Mana: AI use bought with real money (top-up packs, Stage 3 of the budgets pass). When a paid user's daily AI budget
// runs out, Mana pays for their calls instead of the free model answering (ai/budget.ts reserves against the wallet,
// ai/run.ts asks it). Mana never expires, is only for AI answers and has nothing to do with the game's coins.
//   1 Mana = MANA_MICRO_USD of real AI cost ($0.006), so ₹1 of a pack buys about $0.006 of AI: roughly half of the
//   money goes to the models and half to Razorpay's fee, GST and the app.
// This file is the database side only (no payment provider), so billing.ts's webhook and mana.ts's checkout can both
// credit an order without importing each other. An order is credited by inserting its "purchase" row into the
// ledger: a trigger (migration 0023) adds it to the balance, and the ledger's UNIQUE (kind, ref) makes that happen
// exactly once, however many times Checkout, the verify call and the webhook report the same payment.
import { eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { aiWallet, manaLedger, manaOrders } from "../db/schema";

/** What one Mana buys, in micro-dollars of AI cost. */
export const MANA_MICRO_USD = 6000;

export interface Pack { id: "small" | "medium" | "large"; name: string; inr: number; mana: number }
/** The packs on sale. Bigger packs give a little more Mana per rupee. */
export const PACKS: readonly Pack[] = [
  { id: "small", name: "Pouch of Mana", inr: 49, mana: 49 },
  { id: "medium", name: "Flask of Mana", inr: 99, mana: 104 },
  { id: "large", name: "Well of Mana", inr: 199, mana: 219 },
];

export const packById = (id: unknown): Pack | undefined => PACKS.find((p) => p.id === id);

/** Mana for micro-dollars, to one decimal place (rounded down, so it never shows more than there is). */
export const toMana = (micro: number) => Math.floor(Math.max(0, micro) / (MANA_MICRO_USD / 10)) / 10;

/** A user's Mana: what is left to spend (the balance less what calls in flight have reserved). */
export async function walletOf(db: Db, userId: number): Promise<{ mana: number; micro: number }> {
  const row = await db.select().from(aiWallet).where(eq(aiWallet.userId, userId)).get();
  const micro = Math.max(0, (row?.balanceMicro ?? 0) - (row?.reservedMicro ?? 0));
  return { mana: toMana(micro), micro };
}

/**
 * Mark an order paid and credit its Mana, once. true: this call credited it; false: it was already credited, or there
 * is no such order (an unknown order id from a webhook credits nothing: only orders this app created can be paid).
 */
export async function creditOrder(db: Db, orderId: string, paymentId: string | null, now = new Date()): Promise<boolean> {
  const order = await db.select().from(manaOrders).where(eq(manaOrders.id, orderId)).get();
  if (!order) return false;
  const at = now.toISOString();
  const [, credited] = await db.batch([
    db.update(manaOrders)
      .set({ status: "paid", paymentId: sql`coalesce(${manaOrders.paymentId}, ${paymentId})`, paidAt: sql`coalesce(${manaOrders.paidAt}, ${at})` })
      .where(eq(manaOrders.id, orderId)),
    db.insert(manaLedger).values({ userId: order.userId, kind: "purchase", ref: order.id, micro: order.manaMicro, createdAt: at })
      .onConflictDoNothing().returning({ id: manaLedger.id }),
  ]);
  return credited.length > 0;
}
