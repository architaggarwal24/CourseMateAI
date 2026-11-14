import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TermsGate from "./TermsGate";
import { TERMS_VERSION } from "@/lib/legal";

const auth = { user: null as Record<string, unknown> | null, refresh: vi.fn(), logout: vi.fn() };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); auth.refresh.mockReset(); });

// Legal and trust pass (BreakingBreach launch checklist 03/04): an account that hasn't accepted the current Terms
// can't use the app until it ticks the box; nothing is pre-ticked.
describe("the Terms gate", () => {
  it("asks an account with no acceptance, the box unticked; Accept records the current version", async () => {
    auth.user = { user_id: 1, email: "a@x.io", terms_version: null };
    const sent: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      sent.push([String(url), JSON.parse(String(init?.body))]);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    render(<TermsGate />);
    const dialog = screen.getByRole("dialog", { name: "Before you start" });
    expect(dialog.textContent).toMatch(/aged 12 and up/);
    const box = screen.getByRole("checkbox", { name: /I'm 12 or older, and I agree to the Terms of Service and Privacy Policy/ });
    expect((box as HTMLInputElement).checked).toBe(false);
    const accept = screen.getByRole("button", { name: "Accept and continue" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box);
    fireEvent.click(accept);
    await waitFor(() => expect(auth.refresh).toHaveBeenCalled());
    expect(sent).toEqual([[expect.stringMatching(/\/account\/terms$/), { version: TERMS_VERSION }]]);
  });

  it("says the Terms changed for an older acceptance; nothing for the current one or a user object without it", () => {
    auth.user = { user_id: 1, email: "a@x.io", terms_version: "2020-01-01" };
    render(<TermsGate />);
    expect(screen.getByRole("dialog", { name: "We've updated our Terms" })).toBeTruthy();
    cleanup();
    for (const u of [{ user_id: 1, email: "a@x.io", terms_version: TERMS_VERSION }, { user_id: 1, email: "a@x.io" }]) {
      auth.user = u;
      render(<TermsGate />);
      expect(screen.queryByRole("dialog")).toBeNull();
      cleanup();
    }
  });
});
