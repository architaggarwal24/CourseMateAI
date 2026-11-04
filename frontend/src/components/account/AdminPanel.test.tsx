import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const auth = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), apiError: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<object>()), toast: toasts }));

import AdminPanel from "./AdminPanel";

const STUDENT = {
  user_id: 7, email: "s@example.com", username: "stud", full_name: "Stu Dent", email_verified: true, role: "user", is_owner: false,
  banned: false, ban_reason: null, ban_expires: null, created_at: "2026-11-01T00:00:00Z", tier: "apprentice", tier_name: "Apprentice", plan: null,
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const sent: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  sent.length = 0;
  Object.values(toasts).forEach((f) => f.mockReset());
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const u = new URL(url, "http://localhost");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    sent.push({ method, path: u.pathname + u.search, body });
    if (u.pathname === "/api/v1/admin/users") return json({ users: [STUDENT], total: 1, offset: 0, limit: 25 });
    if (u.pathname === "/api/v1/admin/users/7/plan" && method === "PUT") {
      return json({ ...STUDENT, tier: body.tier, tier_name: "Sage", plan: { tier: body.tier, source: "admin", expires_at: "2026-12-05T00:00:00Z", started_at: "x" } });
    }
    if (u.pathname === "/api/v1/admin/invites" && method === "GET") return json({ invites: [] });
    if (u.pathname === "/api/v1/admin/invites" && method === "POST") return json({ code: "SAGE-ABCD2345", tier: "sage", tier_name: "Sage", days: 30, max_uses: 10, uses: 0, usable: true });
    return json({ error: { code: "x", message: "unexpected" } }, 500);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("AdminPanel", () => {
  it("is for admins only", () => {
    auth.user = { user_id: 1, email: "x@x.io", is_admin: false };
    render(<AdminPanel />);
    expect(screen.getByText("Admins only")).toBeTruthy();
  });

  it("lists accounts and gives one a plan for some days", async () => {
    auth.user = { user_id: 1, email: "o@x.io", is_admin: true, is_owner: false };
    render(<AdminPanel />);
    await flush();
    const row = screen.getByRole("list", { name: "Accounts" });
    expect(within(row).getByText("Apprentice (Free)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Manage s@example.com" }));
    expect(screen.queryByRole("button", { name: /Make admin/ })).toBeNull();        // only the owner makes admins
    const dialog = within(screen.getByRole("dialog"));
    fireEvent.change(dialog.getByRole("combobox", { name: "Plan" }), { target: { value: "sage" } });
    fireEvent.change(dialog.getByLabelText("Days"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await flush();
    expect(sent.find((c) => c.method === "PUT")).toMatchObject({ path: "/api/v1/admin/users/7/plan", body: { tier: "sage", days: 30 } });
    expect(toasts.success).toHaveBeenCalled();
  });

  it("the owner can make admins; bad days are caught before sending", async () => {
    auth.user = { user_id: 1, email: "o@x.io", is_admin: true, is_owner: true };
    render(<AdminPanel />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Manage s@example.com" }));
    expect(screen.getByRole("button", { name: /Make admin/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Days"), { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    expect(screen.getByText(/whole number of days/)).toBeTruthy();
    expect(sent.some((c) => c.method === "PUT")).toBe(false);
  });

  it("creates invite codes", async () => {
    auth.user = { user_id: 1, email: "o@x.io", is_admin: true, is_owner: true };
    render(<AdminPanel />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Create code" }));
    await flush();
    expect(sent.find((c) => c.method === "POST")?.body).toMatchObject({ tier: "sage", days: 30, max_uses: 10, valid_days: null });
  });
});
