import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/quests", useSearchParams: () => new URLSearchParams("") }));
const toasts = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: { ...toasts, success: vi.fn(), error: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() } }));

import { InvasionCard, InvasionTeaser, ReviewScroll } from "./BridgeCards";
import InsightMeter from "@/components/shell/InsightMeter";
import HealthyNudge, { NUDGE_AFTER_MS } from "@/components/shell/HealthyNudge";
import { useHUDStore } from "@/hooks/useHUD";
import { useReview } from "@/hooks/useReview";
import { useCourses } from "@/hooks/useCourses";
import { useHeroPrefs, HERO_PREFS_DEFAULT } from "@/hooks/useHeroPrefs";
import { usePortal } from "@/hooks/usePortal";

const invasion = (over: Record<string, unknown> = {}) => ({ ok: true, week: "2026-11-09", ready: true, concepts: ["ATP", "Mitochondria", "Nucleus"], needed: 3,
  species: "kraken", name: "Kraken", repelled: false, reward: { xp: 120, coins: 150 }, ...over });
function serve(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })));
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useCourses.setState({ loaded: true, locked: false, courses: [{ id: "course-1", name: "Bio", documents: [], ready: 1 } as never] });
  usePortal.setState({ phase: "idle", to: null, href: null });
  toasts.info.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("the bridges between the worlds (two worlds, Stage 5)", () => {
  it("Insight shows how full it is, and what full does", () => {
    useHUDStore.setState({ insight: 40 } as never);
    const { rerender } = render(<InsightMeter />);
    expect(screen.getByRole("progressbar", { name: "Insight" }).getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText(/Study to fill it/)).toBeTruthy();
    act(() => { useHUDStore.setState({ insight: 100 } as never); });
    rerender(<InsightMeter />);
    expect(screen.getByText(/Full: your next fight starts with \+1 Focus and a free 50\/50/)).toBeTruthy();
  });

  it("reviews due in Study are a quest in the Hero world; answering the call crosses to Review", () => {
    useReview.setState({ stats: { due: 0 } as never });
    const { rerender } = render(<ReviewScroll />);
    expect(screen.queryByRole("region")).toBeNull();
    act(() => { useReview.setState({ stats: { due: 4 } as never }); });
    rerender(<ReviewScroll />);
    expect(screen.getByRole("region", { name: "4 reviews await" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Review 4 cards" }));
    expect(usePortal.getState()).toMatchObject({ phase: "cover", to: "study", href: "/study?tab=review" });
  });

  it("the weekly invasion: ready (face it), quiet (what wakes it), repelled", async () => {
    serve(invasion());
    render(<InvasionCard />);
    expect(await screen.findByRole("region", { name: "Invasion! The Kraken comes" })).toBeTruthy();
    expect(screen.getByText(/ATP, Mitochondria, Nucleus/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Face the invasion/ }).getAttribute("href")).toBe("/arena?invasion=1&doc=course-1");
    cleanup();
    serve(invasion({ ready: false, concepts: ["ATP"] }));
    render(<InvasionCard />);
    expect(await screen.findByText(/Study at least 3 concepts this week \(1\/3\)/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    serve(invasion({ repelled: true }));
    render(<InvasionCard />);
    expect(await screen.findByRole("region", { name: "Invasion repelled" })).toBeTruthy();
  });

  it("Today hints at a ready invasion (and stays quiet otherwise)", async () => {
    serve(invasion());
    render(<InvasionTeaser />);
    expect(await screen.findByText(/Something stirs in the Hero world/)).toBeTruthy();
    cleanup();
    serve(invasion({ repelled: true }));
    render(<InvasionTeaser />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByText(/Something stirs/)).toBeNull();
  });

  it("after 40 minutes in the Hero world the Scribe suggests your reviews; never mid-fight; off with the switch", () => {
    vi.useFakeTimers();
    useHeroPrefs.setState({ ...HERO_PREFS_DEFAULT, loaded: true });
    useReview.setState({ stats: { due: 3 } as never });
    const fight = document.createElement("div");
    fight.className = "arena--battle";
    document.body.appendChild(fight);
    render(<HealthyNudge />);
    act(() => { vi.advanceTimersByTime(NUDGE_AFTER_MS + 31_000); });
    expect(toasts.info).not.toHaveBeenCalled();                              // a fight on screen: it waits
    fight.remove();
    act(() => { vi.advanceTimersByTime(31_000); });
    expect(toasts.info).toHaveBeenCalledTimes(1);
    expect(toasts.info.mock.calls[0][0]).toMatch(/3 cards wait in Study/);
    act(() => { useHeroPrefs.setState({ nudge: false }); vi.advanceTimersByTime(NUDGE_AFTER_MS * 2); });
    expect(toasts.info).toHaveBeenCalledTimes(1);
  });
});
