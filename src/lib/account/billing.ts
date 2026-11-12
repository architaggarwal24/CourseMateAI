// Subscriptions (server/account/billing.ts; docs/payments.md): Razorpay Checkout, or the test stub.
import { api } from "@/lib/api/client";
import { idempotencyKey } from "@/lib/api/idempotency";
import type { components } from "@/lib/api/generated/schema";

export type BillingStatus = components["schemas"]["BillingStatus"];
export type Checkout = components["schemas"]["CheckoutResponse"];
export type Subscription = components["schemas"]["SubscriptionOut"];
export type Period = "month" | "year";

export async function fetchBilling(): Promise<BillingStatus> {
  const { data } = await api.GET("/billing");
  return data as BillingStatus;
}

export async function startCheckout(tier: string, period: Period): Promise<Checkout> {
  const once = idempotencyKey("billing-checkout", { tier, period });
  const { data } = await api.POST("/billing/checkout", { body: { tier, period }, headers: once.headers });
  once.done();
  return data as Checkout;
}

export interface RazorpaySuccess { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }

export async function verifyPayment(r: RazorpaySuccess): Promise<Subscription> {
  const { data } = await api.POST("/billing/verify", { body: r });
  return data as Subscription;
}

export async function completeStub(subscriptionId: string): Promise<Subscription> {
  const { data } = await api.POST("/billing/stub/complete", { body: { subscription_id: subscriptionId } });
  return data as Subscription;
}

export async function cancelSubscription(): Promise<Subscription> {
  const { data } = await api.POST("/billing/cancel");
  return data as Subscription;
}

export const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";
let loading: Promise<void> | null = null;

/** Razorpay's Checkout script, added to the page the first time someone upgrades (never before). */
export function loadRazorpay(): Promise<void> {
  if (typeof window !== "undefined" && (window as unknown as { Razorpay?: unknown }).Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = CHECKOUT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error("Razorpay Checkout didn't load")); };
    document.head.appendChild(s);
  });
  return loading;
}

type RazorpayCtor = new (options: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (x: unknown) => void) => void };

/** Open Checkout for a subscription. Resolves with the payment (to verify), or null when it was closed. */
export async function payWithRazorpay(c: Checkout): Promise<RazorpaySuccess | null> {
  await loadRazorpay();
  const Razorpay = (window as unknown as { Razorpay: RazorpayCtor }).Razorpay;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  return new Promise((resolve) => {
    const rzp = new Razorpay({
      key: c.key_id, subscription_id: c.subscription_id, name: "CourseMateAI",
      description: `${c.tier_name}, ${c.period === "year" ? "yearly" : "monthly"}`,
      prefill: c.prefill, theme: accent ? { color: accent } : undefined,
      handler: (r: RazorpaySuccess) => resolve(r),
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.open();
  });
}
