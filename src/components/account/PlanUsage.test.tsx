import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bodyOf, json, urlOf } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { user_id: 1 } }) }));

import PlanUsage from "./PlanUsage";
import { flushUndoables } from "@/lib/undo";
import { resetPlansCache } from "@/lib/account/plans";
import { useSessionStore } from "@/hooks/useSessions";

const limits = (documents: number, pdf_mb: number, ai_calls_day: number, tokens_month: number, courses: number) =>
  ({ documents, pdf_mb, ai_calls_day, tokens_month, courses });
const PLANS = {
  invite_only: false, managed_ai: true, payments_enabled: false, currency: "INR",
  plans: [
    { tier: "apprentice", name: "Apprentice", tagline: "Try it.", price_month: 0, price_year: 0, currency: "INR", limits: limits(3, 10, 25, 300000, 0), features: [], highlights: ["Chat"] },
    { tier: "scholar", name: "Scholar", tagline: "A semester.", price_month: 149, price_year: 1490, currency: "INR", limits: limits(15, 25, 150, 3000000, 0), features: ["review_queue"], highlights: ["Review"] },
    { tier: "sage", name: "Sage", tagline: "Courses.", price_month: 299, price_year: 2990, currency: "INR", limits: limits(50, 50, 400, 10000000, 10), features: [], highlights: ["Courses"] },
    { tier: "archmage", name: "Archmage", tagline: "Everything.", price_month: 599, price_year: 5990, currency: "INR", limits: limits(150, 50, 1200, 30000000, 30), features: [], highlights: ["All"] },
  ],
};
const usage = (over = {}) => ({
  tier: "apprentice", tier_name: "Apprentice", source: "default", expires_at: null, limits: limits(3, 10, 25, 300000, 0),
  used: { ai_calls_day: 21, tokens_month: 45000, documents: 2, courses: 0 },
  own_key: { active: false, exempt: true, calls_today: 0, tokens_month: 0 },
  resets: { ai_calls_day: "2026-11-05T00:00:00+00:00", tokens_month: "2026-12-01T00:00:00+00:00" }, history: [], ...over,
});
const doc = (id: string, filename: string) => ({ id, filename, file_hash: id, status: "ready", error: null, chunks: 3,
  embedding_model: "m", created_at: "2026-11-01T00:00:00Z", last_used_at: "2026-11-01T00:00:00Z" });

function server(opts: { redeem?: "ok" | "bad" } = {}) {
  const log = { redeemed: [] as string[], deleted: [] as string[] };
  let docs = [doc("d1", "biology.pdf"), doc("d2", "chemistry.pdf")];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(urlOf(input)).pathname.replace("/api/v1", "");
    const method = (typeof input === "object" && "method" in input ? input.method : init?.method) ?? "GET";
    if (path === "/plans") return json(200, PLANS);
    if (path === "/account/usage") return json(200, usage({ used: { ai_calls_day: 21, tokens_month: 45000, documents: docs.length, courses: 0 } }));
    if (path === "/documents") return json(200, { documents: docs });
    if (path === "/account/redeem") {
      log.redeemed.push((await bodyOf(input, init)).code);
      return opts.redeem === "bad"
        ? json(400, { error: { code: "invite_invalid", message: "That invite code has been used up.", action: null, details: { field: "invite_code" } } })
        : json(200, usage({ tier: "sage", tier_name: "Sage", source: "invite", expires_at: "2026-12-04T10:00:00+00:00", limits: limits(50, 50, 400, 10000000, 10) }));
    }
    const del = path.match(/^\/documents\/(.+)$/);
    if (del && method === "DELETE") { log.deleted.push(del[1]); docs = docs.filter((d) => d.id !== del[1]); return json(200, { success: true }); }
    if (del) return json(404, { error: { code: "document_not_found", message: "gone", action: null, details: null } });
    throw new Error(`unexpected ${method} ${path}`);
  }));
  return log;
}

beforeEach(() => { resetPlansCache(); useSessionStore.getState().clearDocuments(); Object.values(toasts).forEach((f) => f.mockClear()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Plan & usage", () => {
  it("shows the plan, its meters and every plan to compare", async () => {
    server();
    render(<PlanUsage />);
    expect(await screen.findByRole("heading", { name: "Apprentice", level: 2 })).toBeTruthy();
    expect(screen.getByText("The free plan.")).toBeTruthy();
    const calls = screen.getByRole("progressbar", { name: "AI calls today" });
    expect(calls.getAttribute("aria-valuetext")).toBe("21 of 25");
    expect(calls.closest("li")!.getAttribute("data-state")).toBe("near");                   // 84%: nearly used up
    expect(screen.getByRole("progressbar", { name: "AI tokens this month" }).closest("li")!.textContent).toContain("45K");
    expect(screen.queryByText("Courses come with Sage")).toBeNull();          // every plan has courses now
    const cards = within(screen.getByRole("region", { name: "Plans" })).getAllByRole("listitem").filter((li) => li.classList.contains("pu-card"));
    expect(cards.map((c) => c.querySelector("h3")!.textContent)).toEqual(["Apprentice", "Scholar", "Sage", "Archmage"]);
    expect(cards[1].textContent).toContain("₹149/month");
    expect(within(cards[0]).getByText("Your plan")).toBeTruthy();
    expect((within(cards[2]).getByRole("button") as HTMLButtonElement).disabled).toBe(true);    // payments aren't open
    fireEvent.click(screen.getByRole("button", { name: /Yearly/ }));
    expect(cards[1].textContent).toContain("₹1,490/year");
  });

  it("redeems an invite code and shows the new plan, or says why not", async () => {
    const log = server({ redeem: "bad" });
    render(<PlanUsage />);
    await screen.findByRole("heading", { name: "Apprentice", level: 2 });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "beta-sage" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
    expect(await screen.findByText("That invite code has been used up.")).toBeTruthy();
    expect(log.redeemed).toEqual(["BETA-SAGE"]);
    cleanup();
    server({ redeem: "ok" });
    render(<PlanUsage />);
    await screen.findByRole("heading", { name: "Apprentice", level: 2 });
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "BETA-SAGE" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem" }));
    expect(await screen.findByRole("heading", { name: "Sage", level: 2 })).toBeTruthy();
    expect(screen.getByText(/From an invite code until/)).toBeTruthy();
    expect(toasts.success).toHaveBeenCalledWith("You're on Sage now.");
  });

  it("deletes a document at once with an Undo toast (no 'are you sure?'); the request goes when the window closes", async () => {
    const log = server();
    render(<PlanUsage />);
    const box = await screen.findByRole("region", { name: /Your documents/ });
    await within(box).findByText("biology.pdf");
    fireEvent.click(within(box).getByRole("button", { name: "Delete biology.pdf" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(box).queryByText("biology.pdf")).toBeNull();                      // gone from the list at once
    expect(log.deleted).toEqual([]);                                                 // nothing sent yet
    const [message, options] = toasts.success.mock.calls.at(-1)!;
    expect(message).toBe("biology.pdf deleted");

    // Undo: back in the list, and the delete is never sent
    const undo = render(<>{options.action}</>);
    fireEvent.click(undo.getByRole("button", { name: "Undo" }));
    expect(await within(box).findByText("biology.pdf")).toBeTruthy();
    await act(async () => { flushUndoables(); });
    expect(log.deleted).toEqual([]);

    // again, and this time let it go
    fireEvent.click(within(box).getByRole("button", { name: "Delete biology.pdf" }));
    await act(async () => { flushUndoables(); });
    await waitFor(() => expect(log.deleted).toEqual(["d1"]));
    await waitFor(() => expect(within(box).queryByText("biology.pdf")).toBeNull());
  });
});

describe("upgrading", () => {
  function billingServer(provider: "stub" | "razorpay", sub: Record<string, unknown> | null = null) {
    const log = { checkouts: [] as any[], stub: [] as string[], verified: [] as any[], cancelled: 0 };
    let tier = "apprentice";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(urlOf(input)).pathname.replace("/api/v1", "");
      if (path === "/plans") return json(200, { ...PLANS, payments_enabled: true });
      if (path === "/account/usage") return json(200, usage({ tier, tier_name: tier[0].toUpperCase() + tier.slice(1) }));
      if (path === "/documents") return json(200, { documents: [] });
      if (path === "/billing") return json(200, { enabled: true, provider, key_id: provider === "stub" ? "stub" : "rzp_test", subscription: sub });
      if (path === "/billing/checkout") {
        const b = await bodyOf(input, init);
        log.checkouts.push(b);
        return json(200, { provider, subscription_id: "sub_1", key_id: "rzp_test", tier: b.tier, tier_name: "Sage", period: b.period,
                           currency: "INR", amount: b.period === "year" ? 2990 : 299, prefill: { name: "Ada", email: "a@x.io" } });
      }
      const active = { id: "sub_1", provider, tier: "sage", tier_name: "Sage", period: "month", status: "active",
                       current_end: "2026-12-04T00:00:00+00:00", cancel_at_period_end: false };
      if (path === "/billing/stub/complete") { log.stub.push((await bodyOf(input, init)).subscription_id); tier = "sage"; return json(200, active); }
      if (path === "/billing/verify") { log.verified.push(await bodyOf(input, init)); tier = "sage"; return json(200, active); }
      if (path === "/billing/cancel") { log.cancelled += 1; return json(200, { ...active, cancel_at_period_end: true }); }
      throw new Error(`unexpected ${path}`);
    }));
    return log;
  }
  const sageCard = () => within(screen.getByRole("region", { name: "Plans" })).getAllByRole("listitem").find((li) => li.querySelector("h3")?.textContent === "Sage")!;

  it("with the test provider: a test payment dialog, then the new plan", async () => {
    const log = billingServer("stub");
    render(<PlanUsage />);
    await screen.findByRole("heading", { name: "Apprentice", level: 2 });
    fireEvent.click(screen.getByRole("button", { name: /Yearly/ }));
    // auto-renewal is said before paying (legal and trust pass)
    expect(sageCard().textContent).toMatch(/Renews every year at ₹[\d,]+ until you cancel\. Cancel any time in Plan & usage: you keep the plan until the paid period ends\./);
    fireEvent.click(within(sageCard()).getByRole("button", { name: "Upgrade to Sage" }));
    const dialog = await screen.findByRole("dialog", { name: "Test payment" });
    expect(log.checkouts).toEqual([{ tier: "sage", period: "year" }]);
    expect(dialog.textContent).toContain("no money moves");
    fireEvent.click(within(dialog).getByRole("button", { name: /Pay ₹2,990 \(test\)/ }));
    expect(await screen.findByRole("heading", { name: "Sage", level: 2 })).toBeTruthy();
    expect(log.stub).toEqual(["sub_1"]);
    expect(toasts.success).toHaveBeenCalledWith("Welcome to Sage!");
  });

  it("with Razorpay: opens Checkout and verifies what it returns; closing it charges nothing", async () => {
    const log = billingServer("razorpay");
    const opened: any[] = [];
    let mode: "pay" | "close" = "pay";
    (window as any).Razorpay = class {
      constructor(private o: any) { opened.push(o); }
      open() { if (mode === "pay") this.o.handler({ razorpay_payment_id: "pay_9", razorpay_subscription_id: "sub_1", razorpay_signature: "sig" }); else this.o.modal.ondismiss(); }
      on() {}
    };
    render(<PlanUsage />);
    await screen.findByRole("heading", { name: "Apprentice", level: 2 });
    mode = "close";
    fireEvent.click(within(sageCard()).getByRole("button", { name: "Upgrade to Sage" }));
    await waitFor(() => expect(toasts.info).toHaveBeenCalledWith("Checkout closed. Nothing was charged."));
    expect(log.verified).toEqual([]);
    mode = "pay";
    fireEvent.click(within(sageCard()).getByRole("button", { name: "Upgrade to Sage" }));
    expect(await screen.findByRole("heading", { name: "Sage", level: 2 })).toBeTruthy();
    expect(opened[1]).toMatchObject({ key: "rzp_test", subscription_id: "sub_1", name: "CourseMateAI", prefill: { email: "a@x.io" } });
    expect(log.verified).toEqual([{ razorpay_payment_id: "pay_9", razorpay_subscription_id: "sub_1", razorpay_signature: "sig" }]);
    delete (window as any).Razorpay;
  });

  it("shows the subscription and cancels it at the end of the period, after asking", async () => {
    const log = billingServer("razorpay", { id: "sub_1", provider: "razorpay", tier: "sage", tier_name: "Sage", period: "month",
                                            status: "active", current_end: "2026-12-04T00:00:00+00:00", cancel_at_period_end: false });
    render(<PlanUsage />);
    expect(await screen.findByText(/Sage, monthly: renews on 4 Dec 2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel subscription" }));
    const dialog = screen.getByRole("dialog", { name: "Cancel your subscription?" });
    expect(dialog.textContent).toContain("until 4 Dec 2026");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel subscription" }));
    await waitFor(() => expect(log.cancelled).toBe(1));
  });

  it("shows today's AI budget as a share, and Mana packs for paid plans: the stub pays and the balance updates", async () => {
    const mana = { balance: 3.5, can_buy: true, payments_enabled: true, packs: [
      { id: "small", name: "Pouch of Mana", inr: 49, mana: 49 }, { id: "medium", name: "Flask of Mana", inr: 99, mana: 104 }, { id: "large", name: "Well of Mana", inr: 199, mana: 219 },
    ] };
    let balance = 3.5;
    const sent: { path: string; body: unknown; key: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(urlOf(input)).pathname.replace("/api/v1", "");
      if (path === "/plans") return json(200, { ...PLANS, payments_enabled: true });
      if (path === "/billing") return json(200, { enabled: true, provider: "stub", key_id: "stub", subscription: null });
      if (path === "/account/usage") {
        return json(200, usage({ tier: "scholar", tier_name: "Scholar", ai_budget: { limited: true, share: 1, resets_at: "2026-11-05T00:00:00+00:00" }, mana: { ...mana, balance },
          ocr: { used: 4, allowed: 50, resets_at: "2026-11-05T00:00:00+00:00" } }));
      }
      if (path === "/documents") return json(200, { documents: [] });
      if (path.startsWith("/billing/mana/")) {
        sent.push({ path, body: await bodyOf(input, init), key: new Headers(init?.headers).get("Idempotency-Key") });
        if (path === "/billing/mana/checkout") return json(200, { provider: "stub", order_id: "order_stub_1", key_id: "stub", pack: "medium", name: "Flask of Mana", mana: 104, amount: 99, currency: "INR", prefill: {} });
        balance = 107.5;
        return json(200, { status: "paid", mana: 107.5, pack: "medium" });
      }
      throw new Error(`unexpected ${path}`);
    }));
    render(<PlanUsage />);
    const meter = await screen.findByRole("progressbar", { name: "Today's AI budget" });
    expect(screen.getByRole("progressbar", { name: "Scanned pages today" }).getAttribute("aria-valuetext")).toBe("4 of 50");
    expect(meter.getAttribute("aria-valuetext")).toBe("100% used");
    expect(meter.closest("li")!.textContent).toContain("a lighter model answers");
    const box = screen.getByRole("region", { name: /Mana/ });
    expect(box.textContent).toContain("3.5 left");
    expect(box.textContent).toContain("isn't game currency");
    fireEvent.click(within(box).getByRole("button", { name: "Buy Flask of Mana: 104 Mana for ₹99" }));
    const dialog = await screen.findByRole("dialog", { name: "Test payment" });
    expect(dialog.textContent).toContain("104 Mana");
    fireEvent.click(within(dialog).getByRole("button", { name: /Pay ₹99/ }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledWith("Flask of Mana added. You have 107.5 Mana."));
    expect(sent.map((x) => x.path)).toEqual(["/billing/mana/checkout", "/billing/mana/stub"]);
    expect(sent[0]).toMatchObject({ body: { pack: "medium" }, key: expect.any(String) });
    expect(sent[1].body).toEqual({ order_id: "order_stub_1" });
    expect(await within(box).findByText(/107\.5 left/)).toBeTruthy();
  });

  it("the free plan sees Mana is for paid plans, with no packs to buy", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(urlOf(input)).pathname.replace("/api/v1", "");
      if (path === "/plans") return json(200, PLANS);
      if (path === "/billing") return json(200, { enabled: false, provider: null, key_id: null, subscription: null });
      if (path === "/account/usage") return json(200, usage({ mana: { balance: 0, can_buy: false, payments_enabled: true, packs: [{ id: "small", name: "Pouch of Mana", inr: 49, mana: 49 }] } }));
      if (path === "/documents") return json(200, { documents: [] });
      throw new Error(`unexpected ${path}`);
    }));
    render(<PlanUsage />);
    const box = await screen.findByRole("region", { name: /Mana/ });
    expect(box.textContent).toContain("Mana is for Scholar, Sage and Archmage.");
    expect(within(box).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("progressbar", { name: "Today's AI budget" })).toBeNull();     // no ai_budget sent: no meter
  });
});
