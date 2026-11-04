import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const auth = vi.hoisted(() => ({ user: null as null | Record<string, unknown>, refresh: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user, refresh: auth.refresh }) }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), apiError: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<object>()), toast: toasts }));

import SecurityPanel from "./SecurityPanel";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  auth.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url === "/api/auth/two-factor/enable") {
      return body.password === "correct-horse-1"
        ? json({ totpURI: "otpauth://totp/CourseMate:a%40x.io?secret=JBSWY3DPEHPK3PXP&issuer=CourseMate", backupCodes: ["aaaaa-bbbbb", "ccccc-ddddd"] })
        : json({ code: "INVALID_PASSWORD", message: "x" }, 400);
    }
    if (url === "/api/auth/two-factor/verify-totp") return body.code === "123456" ? json({ token: "t" }) : json({ code: "INVALID_CODE", message: "x" }, 401);
    return json({}, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("SecurityPanel", () => {
  it("offers to verify an unverified email", () => {
    auth.user = { user_id: 1, email: "a@x.io", email_verified: false, has_password: true, two_factor_enabled: false };
    render(<SecurityPanel />);
    expect(screen.getByText("Not verified")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Verify my email" }));
    expect(screen.getByRole("button", { name: "Send me a code" })).toBeTruthy();
  });

  it("sets up two-step sign-in: password, QR code and backup codes, then the app's code", async () => {
    auth.user = { user_id: 1, email: "a@x.io", email_verified: true, has_password: true, two_factor_enabled: false };
    render(<SecurityPanel />);
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "wrong-pass-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up two-step sign-in" }));
    await flush();
    expect(screen.getByText(/password isn't right/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "correct-horse-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Set up two-step sign-in" }));
    await flush();
    expect(screen.getByRole("img", { name: /QR code/ })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Backup codes" }).textContent).toContain("aaaaa-bbbbb");
    expect(screen.getByRole("link", { name: "open it in the app" }).getAttribute("href")).toMatch(/^otpauth:/);

    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await flush();
    expect(toasts.success).toHaveBeenCalledWith("Two-step sign-in is on");
    expect(auth.refresh).toHaveBeenCalled();
  });

  it("a Google-only account is told why there's nothing to set", () => {
    auth.user = { user_id: 1, email: "g@x.io", email_verified: true, has_password: false };
    render(<SecurityPanel />);
    expect(screen.getByText(/signs in with Google/)).toBeTruthy();
  });
});
