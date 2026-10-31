import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const auth = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ register: auth.register }) }));

import SignupFlow from "@/components/auth/SignupFlow";
import type { ProviderSpec } from "@/lib/llmProviders";

const GEMINI = {
  id: "gemini", label: "Google Gemini", kind: "gemini", cost: "free", hint: "Free tier.", key_url: "", key_placeholder: "AIza...",
  needs_key: true, base_url_mode: "none", default_base_url: "", presets: [], dev_only: false, allow_custom_model: true,
  models: [{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", free: true, note: "" }], default_model: "gemini-3.8-flash",
} as ProviderSpec;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let taken: string[] = [];
const checked: string[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  taken = [];
  checked.length = 0;
  auth.register.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname === "/api/v1/providers") return json({ providers: [GEMINI] });
    if (url.pathname === "/api/v1/auth/check-username") {
      const name = url.searchParams.get("username")!;
      checked.push(name);
      return json({ available: !taken.includes(name.toLowerCase()), username: name });
    }
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
const onStep2 = () => screen.queryByText("Connect your AI provider") !== null;
const onStep1 = () => screen.queryByText("Your account") !== null;

describe("step 1: the account", () => {
  it("shows the backend's messages beside each field as you leave it", async () => {
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
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
  });

  it("Next stays on the step and lists what is wrong; it does not ask the server", async () => {
    await open();
    await click("Next");
    expect(onStep1()).toBe(true);
    expect(screen.getAllByRole("alert").length).toBe(4);     // (the empty confirmation matches the empty password)
    expect(auth.register).not.toHaveBeenCalled();
  });

  it("checks that the username is free (once it is well-formed) and says so", async () => {
    taken = ["taken_one"];
    await open();
    type("Username", "ab");
    await settle(500);
    expect(checked).toEqual([]);                                   // not well-formed: no request

    type("Username", "free_name"); await settle(500);
    expect(checked).toEqual(["free_name"]);
    expect(screen.getByText("✓ Username is available")).toBeTruthy();

    type("Username", "Taken_One"); await settle(500);
    expect(screen.getByText("That username is already taken")).toBeTruthy();
    await fillAccount();
    type("Username", "taken_one"); await settle(500);
    await click("Next");
    expect(onStep1()).toBe(true);                                  // a taken username blocks Next
  });

  it("debounces: only the name you stopped on is checked", async () => {
    await open();
    for (const v of ["abc", "abcd", "abcde"]) { type("Username", v); await settle(100); }
    await settle(500);
    expect(checked).toEqual(["abcde"]);
  });

  it("Next moves to step 2 with the one sentence about the key", async () => {
    await open();
    await fillAccount();
    await click("Next");
    expect(onStep2()).toBe(true);
    expect(screen.getByText(/stored encrypted/i)).toBeTruthy();
    expect(screen.getByText(/needs your key/i)).toBeTruthy();
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain("AI provider");
  });
});

describe("Back keeps what was typed", () => {
  it("both steps' values survive going back and forth", async () => {
    await open();
    await fillAccount();
    await click("Next");
    type("Google Gemini API key", "AIza-secret");
    await click("Back");
    expect(onStep1()).toBe(true);
    expect((screen.getByLabelText("Full Name") as HTMLInputElement).value).toBe("Ada Lovelace");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ada@example.com");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("correct-horse");
    type("Full Name", "Ada King");
    await click("Next");
    expect((screen.getByLabelText("Google Gemini API key") as HTMLInputElement).value).toBe("AIza-secret");
    await click("Back");
    expect((screen.getByLabelText("Full Name") as HTMLInputElement).value).toBe("Ada King");
  });
});

describe("step 2: connecting the provider", () => {
  const toStep2 = async () => { const done = await open(); await fillAccount(); await click("Next"); return done; };

  it("asks for the key before anything is sent", async () => {
    await toStep2();
    await click("Create Account");
    expect(screen.getByRole("alert").textContent).toBe("Google Gemini API key is required");
    expect(auth.register).not.toHaveBeenCalled();
    expect(onStep2()).toBe(true);
  });

  it("sends exactly what the one-step form sent, then calls onDone", async () => {
    auth.register.mockResolvedValue(true);
    const done = await toStep2();
    type("Google Gemini API key", " AIza-secret ");
    await click("Create Account");
    expect(auth.register).toHaveBeenCalledWith(
      "ada@example.com", "correct-horse", "ada_l", "Ada Lovelace", "AIza-secret", "gemini", "gemini-3.8-flash", undefined,
    );
    expect(done).toHaveBeenCalled();
  });

  it("a failed provider check returns to step 2 with the message beside the key - not to the start", async () => {
    auth.register.mockResolvedValue({ message: "Google Gemini rejected the API key — double-check it and try again.", field: "api_key" });
    await toStep2();
    type("Google Gemini API key", "wrong");
    await click("Create Account");
    expect(onStep2()).toBe(true);
    expect(onStep1()).toBe(false);
    const field = screen.getByLabelText("Google Gemini API key").closest(".ui-field") as HTMLElement;
    expect(within(field).getByRole("alert").textContent).toBe("Google Gemini rejected the API key — double-check it and try again.");
    expect((screen.getByLabelText("Google Gemini API key") as HTMLInputElement).value).toBe("wrong");   // nothing lost
    await click("Back");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ada@example.com");
  });

  it("editing the provider form clears the old complaint", async () => {
    auth.register.mockResolvedValue({ message: "nope", field: "api_key" });
    await toStep2();
    type("Google Gemini API key", "wrong");
    await click("Create Account");
    expect(screen.getByRole("alert").textContent).toBe("nope");
    type("Google Gemini API key", "better");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a message with no field of its own is shown on step 2", async () => {
    auth.register.mockResolvedValue({ message: "Registration failed — check your connection" });
    await toStep2();
    type("Google Gemini API key", "k");
    await click("Create Account");
    expect(onStep2()).toBe(true);
    expect(screen.getByRole("alert").textContent).toBe("Registration failed — check your connection");
  });
});

describe("an account problem the server finds goes back to step 1, beside its field", () => {
  it("taken username / email", async () => {
    auth.register.mockResolvedValue({ message: "Username ada_l is already taken", field: "username" });
    await open();
    await fillAccount();
    await click("Next");
    type("Google Gemini API key", "k");
    await click("Create Account");
    expect(onStep1()).toBe(true);
    const field = screen.getByLabelText("Username").closest(".ui-field") as HTMLElement;
    expect(within(field).getByRole("alert").textContent).toBe("Username ada_l is already taken");
    expect(document.activeElement).toBe(screen.getByLabelText("Username"));
    // fixing it clears the message and the user can continue; the provider key is still there
    type("Username", "ada_l2");
    expect(within(field).queryByRole("alert")).toBeNull();
    await settle(500);
    await click("Next");
    expect((screen.getByLabelText("Google Gemini API key") as HTMLInputElement).value).toBe("k");
  });
});
