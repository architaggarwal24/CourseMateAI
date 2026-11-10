import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/study" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ push: vi.fn() }) }));
const api = vi.hoisted(() => ({ seen: vi.fn(async (_id: number) => {}) }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), markPlanNoticeSeen: api.seen }));

import { useHUDStore } from "@/hooks/useHUD";
import { PLAN_CHANGED_EVENT, noticeTexts, previewNotice, type PlanNotice } from "@/lib/planNotice";
import UpgradeCeremony from "./UpgradeCeremony";
import { useCeremonyQueue } from "./ceremonyQueue";

const SAGE: PlanNotice = {
  id: 7, kind: "upgrade", tier: "sage", tier_name: "Sage", from_tier: "apprentice", from_tier_name: "Apprentice", source: "admin",
  expires_at: "2026-12-10T00:00:00Z", from_expires_at: null, note: "Thanks for testing!", from_name: "Archit",
  unlocked: [{ feature: "review_queue", name: "Spaced-repetition review" }, { feature: "exam_mode", name: "Exam mode" }],
  gains: [{ key: "documents", from: 3, to: 50 }], created_at: "2026-11-10T00:00:00Z",
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useHUDStore.setState({ userId: "9", guestMode: false, planNotice: null });
  useCeremonyQueue.setState({ levelUpOpen: false });
  nav.path = "/study";
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); api.seen.mockClear(); });

describe("you've been upgraded", () => {
  it("opens once for a notice: the plan, who it's from, the note, what's new; marked seen as it opens", () => {
    const changed = vi.fn();
    window.addEventListener(PLAN_CHANGED_EVENT, changed);
    render(<UpgradeCeremony />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { useHUDStore.setState({ planNotice: SAGE }); });
    const dialog = screen.getByRole("dialog", { name: "You've been upgraded to Sage" });
    expect(screen.getByTestId("upgrade-window").dataset.variant).toBe("study");
    expect(dialog.textContent).toContain("A gift from Archit");
    expect(dialog.textContent).toContain("Thanks for testing!");
    expect(dialog.textContent).toContain("Until 10 Dec 2026");
    expect(dialog.textContent).toContain("Spaced-repetition review");
    expect(dialog.textContent).toContain("Up to 50 PDFs (was 3)");
    expect(screen.getByRole("link", { name: "Start a review" }).getAttribute("href")).toBe("/study?tab=review");
    expect(api.seen).toHaveBeenCalledWith(7);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(useHUDStore.getState().planNotice).toBeNull();
    // closed; the same notice arriving again (a HUD answer that was already on its way) doesn't reopen it
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { useHUDStore.setState({ planNotice: SAGE }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    window.removeEventListener(PLAN_CHANGED_EVENT, changed);
  });

  it("in the Hero area it's the pixel celebration, and it waits for the level-up screen", () => {
    nav.path = "/hero";
    useCeremonyQueue.setState({ levelUpOpen: true });
    render(<UpgradeCeremony />);
    act(() => { useHUDStore.setState({ planNotice: { ...SAGE, id: 8 } }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => { useCeremonyQueue.setState({ levelUpOpen: false }); });
    expect(screen.getByRole("dialog", { name: "Upgraded!" })).toBeTruthy();
    expect(screen.getByTestId("upgrade-window").dataset.variant).toBe("play");
    expect(screen.getByRole("button", { name: "Onward" })).toBeTruthy();
  });
});

describe("the window's words", () => {
  it("an extension says until when, and was when; invites and payments say where it came from", () => {
    const ext = noticeTexts({ ...SAGE, kind: "extend", from_tier: "sage", unlocked: [], gains: [], from_expires_at: "2026-11-20T00:00:00Z", source: "invite" });
    expect(ext).toMatchObject({ title: "Your Sage plan got longer", from: "Your invite code worked", lines: ["Now until 10 Dec 2026 (was 20 Nov 2026)"] });
    expect(ext.cta).toEqual({ label: "See your plan", href: "/account/usage" });
    expect(noticeTexts({ ...SAGE, source: "subscription" }).from).toBe("Payment received. Thank you!");
    expect(noticeTexts({ ...SAGE, from_name: null }).from).toBe("A gift from the CourseMateAI team");
    expect(noticeTexts({ ...SAGE, expires_at: null }).until).toBe("No end date");
  });

  it("the admin's preview works out the same window, or none when it isn't an upgrade", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    const limits = { apprentice: { documents: 3, courses: 1 }, sage: { documents: 50, courses: 10 } };
    const p = previewNotice({ fromTier: "apprentice", fromExpiresAt: null, toTier: "sage", days: 30, note: " Hi  there ", fromName: "Archit", limits, now });
    expect(p).toMatchObject({ kind: "upgrade", tier: "sage", expires_at: "2026-12-10T00:00:00Z", note: "Hi there", from_name: "Archit" });
    expect(p?.unlocked.map((u) => u.feature)).toEqual(["review_queue", "exam_mode", "concept_map", "pdf_viewer"]);
    expect(p?.gains).toEqual([{ key: "documents", from: 3, to: 50 }, { key: "courses", from: 1, to: 10 }]);
    expect(previewNotice({ fromTier: "sage", fromExpiresAt: "2026-11-20T00:00:00Z", toTier: "sage", days: 30, note: "", fromName: null, limits, now })?.kind).toBe("extend");
    expect(previewNotice({ fromTier: "sage", fromExpiresAt: null, toTier: "scholar", days: null, note: "", fromName: null, limits, now })).toBeNull();
  });
});
