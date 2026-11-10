/** @vitest-environment node */
// Billing on the Worker (Stage 4.6): off by default; the stub's whole flow; Razorpay's signatures and webhooks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as billing from "@/app/api/v1/billing/route";
import * as checkout from "@/app/api/v1/billing/checkout/route";
import * as verifyRoute from "@/app/api/v1/billing/verify/route";
import * as cancelRoute from "@/app/api/v1/billing/cancel/route";
import * as stubComplete from "@/app/api/v1/billing/stub/complete/route";
import * as webhookRoute from "@/app/api/v1/billing/webhook/route";
import * as usage from "@/app/api/v1/account/usage/route";
import * as plans from "@/app/api/v1/plans/route";
import * as hudRoute from "@/app/api/v1/hud/route";
import { setMailerForTests } from "./context";
import { setEnvForTests } from "./env";
import { provider, razorpay, setProviderForTests, stub, type Provider } from "./billing";
import { fakeMailer, json, ORIGIN, SETTINGS } from "./test/auth-helpers";
import { localPlatform, type LocalPlatform } from "./test/platform";
import { person } from "./test/flows";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  for (const [k, v] of Object.entries(SETTINGS)) vi.stubEnv(k, v as string);
}, 60_000);
afterEach(async () => {
  setEnvForTests(null); setMailerForTests(null); setProviderForTests(undefined);
  vi.unstubAllEnvs();
  await p?.dispose();
});

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("which provider", () => {
  it("is none unless PAYMENTS_ENABLED; the stub only on purpose; Razorpay only with keys", () => {
    expect(provider({})).toBeNull();
    expect(provider({ PAYMENTS_ENABLED: "1", PAYMENTS_PROVIDER: "stub" })?.name).toBe("stub");
    expect(provider({ PAYMENTS_ENABLED: "1" })).toBeNull();
    expect(provider({ PAYMENTS_ENABLED: "true", RAZORPAY_KEY_ID: "rzp_test", RAZORPAY_KEY_SECRET: "s" })?.name).toBe("razorpay");
  });
});

describe("billing", () => {
  it("/plans tells the UI whether it can sell", async () => {
    setProviderForTests(null);
    expect((await json(await plans.GET(new Request(`${ORIGIN}/api/v1/plans`)))).payments_enabled).toBe(false);
    setProviderForTests(stub());
    expect((await json(await plans.GET(new Request(`${ORIGIN}/api/v1/plans`)))).payments_enabled).toBe(true);
  });

  it("off: says so, and checkout is refused", async () => {
    setProviderForTests(null);
    const b = await person(mail, "free@example.com", "free");
    expect(await json(await billing.GET(b.request("/api/v1/billing")))).toEqual({ enabled: false, provider: null, key_id: null, subscription: null });
    expect((await json(await checkout.POST(b.request("/api/v1/billing/checkout", { body: { tier: "sage", period: "month" } })))).error.code).toBe("payments_unavailable");
  });

  it("the stub: checkout, pay, the plan is on; again is refused; cancel keeps it to the period's end", async () => {
    setProviderForTests(stub());
    const b = await person(mail, "free@example.com", "free");
    expect((await checkout.POST(b.request("/api/v1/billing/checkout", { body: { tier: "apprentice", period: "month" } }))).status).toBe(400);
    const c = await json(await checkout.POST(b.request("/api/v1/billing/checkout", { body: { tier: "sage", period: "month" } })));
    expect(c).toMatchObject({ provider: "stub", tier: "sage", period: "month", currency: "INR", amount: 299, prefill: { email: "free@example.com" } });
    const sub = await json(await stubComplete.POST(b.request("/api/v1/billing/stub/complete", { body: { subscription_id: c.subscription_id } })));
    expect(sub).toMatchObject({ status: "active", tier: "sage", cancel_at_period_end: false });
    const u = await json(await usage.GET(b.request("/api/v1/account/usage")));
    expect(u).toMatchObject({ tier: "sage", source: "subscription" });
    // the thank-you window: once, for the new plan
    expect((await json(await hudRoute.GET(b.request("/api/v1/hud")))).plan_notice).toMatchObject({ kind: "upgrade", tier: "sage", source: "subscription", from_tier: "apprentice" });
    expect((await json(await checkout.POST(b.request("/api/v1/billing/checkout", { body: { tier: "sage", period: "month" } })))).error.code).toBe("already_subscribed");
    expect(await json(await cancelRoute.POST(b.request("/api/v1/billing/cancel", { body: {} })))).toMatchObject({ cancel_at_period_end: true });
    expect((await json(await usage.GET(b.request("/api/v1/account/usage")))).tier).toBe("sage");
    const other = await person(mail, "other@example.com", "other");
    expect((await verifyRoute.POST(other.request("/api/v1/billing/verify", { body: { razorpay_payment_id: "p", razorpay_subscription_id: c.subscription_id, razorpay_signature: "stub" } }))).status).toBe(404);
  });

  it("Razorpay: Checkout's signature and the webhook's are HMAC-SHA256; each event counts once; a halt ends the plan", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      if (String(url).endsWith("/subscriptions")) return Response.json({ id: "sub_1", status: "created", short_url: "https://rzp.io/x" });
      return Response.json({ id: "sub_1", status: "active", current_start: 1_700_000_000, current_end: 1_900_000_000 });
    }) as unknown as typeof fetch;
    const rp: Provider = razorpay("rzp_test", "key-secret", "hook-secret", { "scholar:month": "plan_s" }, fake);
    setProviderForTests(rp);
    const b = await person(mail, "free@example.com", "free");
    expect((await json(await checkout.POST(b.request("/api/v1/billing/checkout", { body: { tier: "sage", period: "year" } })))).error.code).toBe("plan_not_on_sale");
    const c = await json(await checkout.POST(b.request("/api/v1/billing/checkout", { body: { tier: "scholar", period: "month" } })));
    expect(c).toMatchObject({ subscription_id: "sub_1", key_id: "rzp_test", short_url: "https://rzp.io/x" });
    const bad = await verifyRoute.POST(b.request("/api/v1/billing/verify", { body: { razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_1", razorpay_signature: "nope" } }));
    expect((await json(bad)).error.code).toBe("payment_unverified");
    const sig = await hmac("key-secret", "pay_1|sub_1");
    expect(await json(await verifyRoute.POST(b.request("/api/v1/billing/verify", { body: { razorpay_payment_id: "pay_1", razorpay_subscription_id: "sub_1", razorpay_signature: sig } }))))
      .toMatchObject({ status: "active", tier: "scholar", current_end: "2030-03-17T17:46:40Z" });

    const event = JSON.stringify({ event: "subscription.halted", payload: { subscription: { entity: { id: "sub_1", status: "halted" } } } });
    const hook = async (sig: string) => webhookRoute.POST(new Request(`${ORIGIN}/api/v1/billing/webhook`, {
      method: "POST", body: event, headers: { "x-razorpay-signature": sig, "x-razorpay-event-id": "evt_1", "cf-connecting-ip": "10.0.0.1" },
    }));
    expect((await hook("bad")).status).toBe(400);
    const good = await hmac("hook-secret", event);
    expect(await json(await hook(good))).toEqual({ ok: true });
    expect(await json(await hook(good))).toEqual({ ok: true, duplicate: true });
    expect((await json(await usage.GET(b.request("/api/v1/account/usage")))).tier).toBe("apprentice");
    expect(calls[0]).toBe("POST https://api.razorpay.com/v1/subscriptions");
  });
});
