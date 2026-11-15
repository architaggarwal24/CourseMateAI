/** @vitest-environment node */
// Mana (top-up packs for AI use): paid plans only, payments on only; the stub's flow; Razorpay Orders' signature,
// "pending" until paid, and the order.paid webhook; every order credited exactly once, only orders the app created.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as manaCheckout from "@/app/api/v1/billing/mana/checkout/route";
import * as manaVerify from "@/app/api/v1/billing/mana/verify/route";
import * as manaStub from "@/app/api/v1/billing/mana/stub/route";
import * as webhookRoute from "@/app/api/v1/billing/webhook/route";
import * as usage from "@/app/api/v1/account/usage/route";
import { setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { getDb } from "../db";
import { razorpay, setProviderForTests, stub } from "./billing";
import { creditOrder, MANA_MICRO_USD, PACKS, toMana, walletOf } from "./wallet";
import { fakeMailer, json, ORIGIN, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { person } from "../test/flows";

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

/** Put a user on a plan directly (as an admin grant would). */
async function onPlan(email: string, tier: string) {
  const row = await p.env.DB.prepare("SELECT id FROM user WHERE email = ?").bind(email).first<{ id: number }>();
  await p.env.DB.prepare("INSERT INTO user_plans (user_id, tier, source, started_at, updated_at) VALUES (?, ?, 'admin', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')")
    .bind(row!.id, tier).run();
  return row!.id;
}
const wallet = (id: number) => p.env.DB.prepare("SELECT balance_micro AS balance, reserved_micro AS reserved FROM ai_wallet WHERE user_id = ?").bind(id).first<{ balance: number; reserved: number }>();
const buy = (b: Awaited<ReturnType<typeof person>>, pack: string) => manaCheckout.POST(b.request("/api/v1/billing/mana/checkout", { body: { pack } }));

describe("the packs", () => {
  it("give a little more Mana per rupee as they grow, and Mana shows rounded down", () => {
    expect(PACKS.map((x) => [x.inr, x.mana])).toEqual([[49, 49], [99, 104], [199, 219]]);
    expect(PACKS[2].mana / PACKS[2].inr).toBeGreaterThan(PACKS[0].mana / PACKS[0].inr);
    expect(toMana(49 * MANA_MICRO_USD)).toBe(49);
    expect(toMana(MANA_MICRO_USD * 1.99)).toBe(1.9);
  });
});

describe("buying Mana", () => {
  it("is refused while payments are off, and for the free plan", async () => {
    setProviderForTests(null);
    const b = await person(mail, "free@example.com", "free");
    expect((await json(await buy(b, "small"))).error.code).toBe("payments_unavailable");
    setProviderForTests(stub());
    const r = await buy(b, "small");
    expect(r.status).toBe(403);
    expect((await json(r)).error).toMatchObject({ code: "mana_paid_plans_only", action: "plans" });
    await onPlan("free@example.com", "scholar");
    expect((await json(await buy(b, "huge"))).error.code).toBe("invalid_pack");
  });

  it("the stub: checkout, pay, the Mana is there once however often it's reported; someone else's order is refused", async () => {
    setProviderForTests(stub());
    const b = await person(mail, "s@example.com", "scholar1");
    const id = await onPlan("s@example.com", "scholar");
    const c = await json(await buy(b, "medium"));
    expect(c).toMatchObject({ provider: "stub", pack: "medium", mana: 104, amount: 99, currency: "INR", prefill: { email: "s@example.com" } });
    const paid = await json(await manaStub.POST(b.request("/api/v1/billing/mana/stub", { body: { order_id: c.order_id } })));
    expect(paid).toEqual({ status: "paid", mana: 104, pack: "medium" });
    await manaStub.POST(b.request("/api/v1/billing/mana/stub", { body: { order_id: c.order_id } }));
    expect(await creditOrder(getDb(p.env.DB), c.order_id, "again")).toBe(false);
    expect(await wallet(id)).toEqual({ balance: 104 * MANA_MICRO_USD, reserved: 0 });
    const ledger = await p.env.DB.prepare("SELECT kind, ref, micro FROM mana_ledger").all();
    expect(ledger.results).toEqual([{ kind: "purchase", ref: c.order_id, micro: 104 * MANA_MICRO_USD }]);
    const other = await person(mail, "o@example.com", "other");
    expect((await manaVerify.POST(other.request("/api/v1/billing/mana/verify", { body: { razorpay_payment_id: "p", razorpay_order_id: c.order_id, razorpay_signature: "stub" } }))).status).toBe(404);
    // the Plan & usage page shows it
    const u = await json(await usage.GET(b.request("/api/v1/account/usage")));
    expect(u.mana).toMatchObject({ balance: 104, can_buy: true, payments_enabled: true, packs: expect.arrayContaining([expect.objectContaining({ id: "small", inr: 49 })]) });
    expect(u.ai_budget).toMatchObject({ limited: true, share: 0 });
  });

  it("Razorpay: an order in paise, Checkout's order|payment signature, pending until paid, then the webhook credits it once", async () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    let status = "attempted";
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
      if (String(url).endsWith("/orders")) return Response.json({ id: "order_1", status: "created" });
      return Response.json({ id: "order_1", status });
    }) as unknown as typeof fetch;
    setProviderForTests(razorpay("rzp_test", "key-secret", "hook-secret", {}, fake));
    const b = await person(mail, "s@example.com", "scholar1");
    const id = await onPlan("s@example.com", "sage");
    const c = await json(await buy(b, "large"));
    expect(c).toMatchObject({ order_id: "order_1", key_id: "rzp_test", amount: 199, mana: 219 });
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.razorpay.com/v1/orders", body: { amount: 19900, currency: "INR", notes: { pack: "large", kind: "mana" } } });

    const verify = (signature: string) => manaVerify.POST(b.request("/api/v1/billing/mana/verify", { body: { razorpay_payment_id: "pay_1", razorpay_order_id: "order_1", razorpay_signature: signature } }));
    expect((await json(await verify("nope"))).error.code).toBe("payment_unverified");
    const sig = await hmac("key-secret", "order_1|pay_1");
    expect(await json(await verify(sig))).toEqual({ status: "pending", mana: 0, pack: "large" });     // not captured yet
    expect(await wallet(id)).toBeNull();

    const hook = async (eventId: string, orderId = "order_1") => {
      const event = JSON.stringify({ event: "order.paid", payload: { order: { entity: { id: orderId, status: "paid" } }, payment: { entity: { id: "pay_1", order_id: orderId } } } });
      return webhookRoute.POST(new Request(`${ORIGIN}/api/v1/billing/webhook`, {
        method: "POST", body: event, headers: { "x-razorpay-signature": await hmac("hook-secret", event), "x-razorpay-event-id": eventId, "cf-connecting-ip": "10.0.0.2" },
      }));
    };
    expect(await json(await hook("evt_1"))).toEqual({ ok: true });
    expect(await json(await hook("evt_1"))).toEqual({ ok: true, duplicate: true });
    expect(await json(await hook("evt_2"))).toEqual({ ok: true, ignored: true });      // a second report of the same order
    status = "paid";
    expect(await json(await verify(sig))).toEqual({ status: "paid", mana: 219, pack: "large" });     // and Checkout's own
    expect(await wallet(id)).toEqual({ balance: 219 * MANA_MICRO_USD, reserved: 0 });
    // an order this app never created credits nothing
    expect(await json(await hook("evt_3", "order_forged"))).toEqual({ ok: true, ignored: true });
    expect((await p.env.DB.prepare("SELECT count(*) AS n FROM mana_ledger").first<{ n: number }>())!.n).toBe(1);
  });

  it("the wallet shows what isn't reserved by calls in flight", async () => {
    setProviderForTests(stub());
    const b = await person(mail, "s@example.com", "scholar1");
    const id = await onPlan("s@example.com", "scholar");
    const c = await json(await buy(b, "small"));
    await manaStub.POST(b.request("/api/v1/billing/mana/stub", { body: { order_id: c.order_id } }));
    await p.env.DB.prepare("UPDATE ai_wallet SET reserved_micro = ? WHERE user_id = ?").bind(9 * MANA_MICRO_USD, id).run();
    expect(await walletOf(getDb(p.env.DB), id)).toEqual({ mana: 40, micro: 40 * MANA_MICRO_USD });
  });
});
