// Buying Mana (server/account/mana.ts; docs/payments.md): a one-time Razorpay order opened in Checkout, or the test
// stub. Mana pays for AI answers once the day's own budget is used up; it is not game currency.
import { API_BASE_URL, throwForResponse } from "@/lib/api/client";
import { idempotencyKey } from "@/lib/api/idempotency";
import { loadRazorpay } from "./billing";

export interface ManaCheckout {
  provider: "razorpay" | "stub"; order_id: string; key_id: string; pack: string; name: string; mana: number;
  amount: number; currency: "INR"; prefill: Record<string, string>;
}
export interface ManaPaid { status: "paid" | "pending"; mana: number; pack: string }
export interface RazorpayOrderSuccess { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }

async function post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST", credentials: "include", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as T;
}

export async function startManaCheckout(pack: string): Promise<ManaCheckout> {
  const once = idempotencyKey("mana-checkout", { pack });
  const c = await post<ManaCheckout>("/billing/mana/checkout", { pack }, once.headers);
  once.done();
  return c;
}

export const verifyMana = (r: RazorpayOrderSuccess) => post<ManaPaid>("/billing/mana/verify", r);
export const completeManaStub = (orderId: string) => post<ManaPaid>("/billing/mana/stub", { order_id: orderId });

type RazorpayCtor = new (options: Record<string, unknown>) => { open: () => void };

/** Open Checkout for a Mana order. Resolves with the payment (to verify), or null when it was closed. */
export async function payManaWithRazorpay(c: ManaCheckout): Promise<RazorpayOrderSuccess | null> {
  await loadRazorpay();
  const Razorpay = (window as unknown as { Razorpay: RazorpayCtor }).Razorpay;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  return new Promise((resolve) => {
    new Razorpay({
      key: c.key_id, order_id: c.order_id, amount: c.amount * 100, currency: c.currency, name: "CourseMateAI",
      description: `${c.name}: ${c.mana} Mana`, prefill: c.prefill, theme: accent ? { color: accent } : undefined,
      handler: (r: RazorpayOrderSuccess) => resolve(r),
      modal: { ondismiss: () => resolve(null) },
    }).open();
  });
}
