import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const auth = vi.hoisted(() => ({ register: vi.fn(), refresh: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ register: auth.register, refresh: auth.refresh }) }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), apiError: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<object>()), toast: toasts }));

import SignupFlow from "@/components/auth/SignupFlow";
import { resetAuthConfigCache } from "@/lib/auth/config";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let taken: string[] = [];
let emails = true;
const checked: string[] = [];
const calls: { path: string; body: unknown }[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  taken = [];
  emails = true;
  checked.length = 0;
  calls.length = 0;
  auth.register.mockReset();
  auth.refresh.mockReset();
  toasts.success.mockReset();
  toasts.apiError.mockReset();
  resetAuthConfigCache();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(String(input), "http://localhost"), init);
    const url = new URL(req.url);
    const body = req.method === "GET" ? null : await req.clone().json().catch(() => null);
    calls.push({ path: url.pathname, body });
    if (url.pathname === "/api/v1/auth/config") return json({ google: false, email_delivery: emails, verification_required: emails, invite_only: false });
    if (url.pathname === "/api/v1/auth/check-username") {
      const name = url.searchParams.get("username")!;
      checked.push(name);
      return json({ available: !taken.includes(name.toLowerCase()), username: name });
    }
    if (url.pathname === "/api/auth/email-otp/verify-email") {
      return (body as { otp: string }).otp === "123456" ? json({ status: true }) : json({ code: "INVALID_OTP", message: "Invalid OTP" }, 400);
    }
    if (url.pathname === "/api/auth/email-otp/send-verification-otp") return json({ success: true });
    if (url.pathname === "/api/v1/account/redeem") return json({ tier: "sage" });
    throw new Error(`unexpected ${url.pathname}`);
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const blur = (label: string) => fireEvent.blur(screen.getByLabelText(label));
const click = (name: string) => act(async () => { fireEvent.click(screen.getByRole("button", { name })); await vi.advanceTimersByTimeAsync(0); });

async function open(onDone = vi.fn()) {
  render(<SignupFlow onDone={onDone} />);
  await settle();
  return onDone;
}
async function fillAccount() {
  type("Full Name", "Ada Lovelace");
  type("Username", "ada_l");
  type("Email", "ada@example.com");
  type("Password", "correct-horse");
  type("Confirm Password", "correct-horse");
  await settle(500);
}

describe("the account step", () => {
  it("shows the server's messages beside each field as you leave it", async () => {
    await open();
    type("Username", "ab"); blur("Username");
    type("Email", "nope"); blur("Email");
    type("Password", "short"); blur("Password");
    type("Confirm Password", "other"); blur("Confirm Password");
    blur("Full Name");
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual([
      "Full name is required", "Username must be at least 3 characters", "Invalid email format",
      "Password must be at least 8 characters", "Passwords do not match",
    ]);
    expect(within(screen.getByLabelText("Email").closest(".ui-field") as HTMLElement).getByRole("alert").textContent).toBe("Invalid email format");
  });

  it("Create Account stays put and lists what is wrong; it does not ask the server", async () => {
    await open();
    await click("Create Account");
    expect(screen.getAllByRole("alert").length).toBe(4);
    expect(auth.register).not.toHaveBeenCalled();
  });

  it("checks that the username is free (once it is well-formed) and says so", async () => {
    taken = ["taken_one"];
    await open();
    type("Username", "ab");
    await settle(500);
    expect(checked).toEqual([]);
    type("Username", "free_name"); await settle(500);
    expect(screen.getByText("✓ Username is available")).toBeTruthy();
    type("Username", "Taken_One"); await settle(500);
    expect(screen.getByText("That username is already taken")).toBeTruthy();
    await fillAccount();
    type("Username", "taken_one"); await settle(500);
    await click("Create Account");
    expect(auth.register).not.toHaveBeenCalled();
  });

  it("debounces: only the name you stopped on is checked", async () => {
    await open();
    for (const v of ["abc", "abcd", "abcde"]) { type("Username", v); await settle(100); }
    await settle(500);
    expect(checked).toEqual(["abcde"]);
  });

  it("a taken email from the server lands beside the email field", async () => {
    auth.register.mockResolvedValue({ ok: false, failure: { message: "An account with that email already exists. Log in instead?", field: "email" } });
    await open();
    await fillAccount();
    await click("Create Account");
    expect(within(screen.getByLabelText("Email").closest(".ui-field") as HTMLElement).getByRole("alert").textContent).toMatch(/already exists/);
  });

  it("a message with no field is shown on the form", async () => {
    auth.register.mockResolvedValue({ ok: false, failure: { message: "Too many tries. Please wait a moment and try again." } });
    await open();
    await fillAccount();
    await click("Create Account");
    expect(screen.getByRole("alert").textContent).toMatch(/Too many tries/);
  });
});

describe("verifying the email", () => {
  it("sends the account, then asks for the emailed code, then finishes", async () => {
    auth.register.mockResolvedValue({ ok: true, signedIn: false });
    const onDone = await open();
    await fillAccount();
    await click("Create Account");
    expect(auth.register).toHaveBeenCalledWith({ email: "ada@example.com", password: "correct-horse", username: "ada_l", fullName: "Ada Lovelace" });
    expect(screen.getByText("Verify your email")).toBeTruthy();
    expect(screen.getByText(/sent a 6-digit code to ada@example.com/)).toBeTruthy();
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain("Verify email");

    type("6-digit code", "111111");
    await click("Verify");
    expect(screen.getByRole("alert").textContent).toMatch(/isn't right/);
    expect(onDone).not.toHaveBeenCalled();

    type("6-digit code", "123456");
    await click("Verify");
    expect(auth.refresh).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("without an email service there is no code step", async () => {
    emails = false;
    auth.register.mockResolvedValue({ ok: true, signedIn: true });
    const onDone = await open();
    expect(screen.queryByLabelText("Sign-up progress")).toBeNull();
    await fillAccount();
    await click("Create Account");
    expect(onDone).toHaveBeenCalled();
  });

  it("uses the invite code once signed in", async () => {
    auth.register.mockResolvedValue({ ok: true, signedIn: true });
    const onDone = await open();
    await fillAccount();
    type("Invite code (optional)", "BETA-SAGE");
    await click("Create Account");
    expect(calls.find((c) => c.path === "/api/v1/account/redeem")?.body).toEqual({ code: "BETA-SAGE" });
    expect(toasts.success).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });
});
