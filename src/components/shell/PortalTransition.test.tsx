import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }), usePathname: () => "/today", useSearchParams: () => new URLSearchParams("") }));
const motion = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async (orig) => ({ ...(await orig<typeof import("motion/react")>()), useReducedMotionConfig: () => motion.reduce }));

import PortalTransition, { COVER_MS, FADE_MS, REVEAL_MS } from "./PortalTransition";
import PortalLink from "./PortalLink";
import { usePortal } from "@/hooks/usePortal";
import { lastPage, rememberPage } from "@/lib/worlds";

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); usePortal.setState({ phase: "idle", to: null, href: null }); nav.push.mockReset(); motion.reduce = false; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("each world remembers where you were (Stage 2)", () => {
  it("the portal goes back to your last page in that world, or the world's home; a page from the other world doesn't count", () => {
    expect(lastPage("hero")).toBe("/arena");
    expect(lastPage("study")).toBe("/today");
    rememberPage("hero", "/champion?tab=shop");
    rememberPage("study", "/study?tab=quiz&doc=d1");
    expect(lastPage("hero")).toBe("/champion?tab=shop");
    expect(lastPage("study")).toBe("/study?tab=quiz&doc=d1");
    rememberPage("hero", "/study?tab=chat");                                 // not a Hero page
    rememberPage("hero", "//evil.example");                                  // not a path in the app
    localStorage.setItem("cmai_world_hero", "/study");
    expect(lastPage("hero")).toBe("/arena");
  });
});

describe("the crossing", () => {
  it("blocks cover the screen, the page changes, the new world shows, the blocks fall away; it's announced and focus lands in the new menu", () => {
    const { rerender } = render(<><nav aria-label="Main"><a href="/today" aria-current="page">Today</a></nav><PortalTransition world="study" /></>);
    act(() => { usePortal.getState().cross("hero", "/champion?tab=shop"); });
    const fx = screen.getByTestId("portal-fx");
    expect(fx.getAttribute("data-phase")).toBe("cover");
    expect(fx.querySelectorAll(".portal-fx__cell").length).toBe(160);
    expect(nav.push).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(COVER_MS); });
    expect(nav.push).toHaveBeenCalledWith("/champion?tab=shop");
    // the Hero world comes up behind the blocks
    rerender(<><nav aria-label="Main"><a href="/arena">Arena</a><a href="/champion?tab=shop" aria-current="page">Shop</a></nav><PortalTransition world="hero" /></>);
    act(() => { vi.advanceTimersByTime(20); });
    expect(screen.getByTestId("portal-fx").getAttribute("data-phase")).toBe("reveal");
    expect(screen.getByRole("status").textContent).toBe("Entered the Hero world");
    act(() => { vi.advanceTimersByTime(REVEAL_MS); });
    expect(screen.queryByTestId("portal-fx")).toBeNull();
    expect(usePortal.getState().phase).toBe("idle");
  });

  it("reduced motion: a quick fade instead of the blocks", () => {
    motion.reduce = true;
    const { rerender } = render(<PortalTransition world="hero" />);
    act(() => { usePortal.getState().cross("study", "/today"); });
    expect(screen.getByTestId("portal-fx").querySelector(".portal-fx__fade")).toBeTruthy();
    expect(screen.getByTestId("portal-fx").querySelectorAll(".portal-fx__cell").length).toBe(0);
    act(() => { vi.advanceTimersByTime(FADE_MS); });
    expect(nav.push).toHaveBeenCalledWith("/today");
    rerender(<PortalTransition world="study" />);
    act(() => { vi.advanceTimersByTime(20); });
    expect(screen.getByRole("status").textContent).toBe("Back in Study");
    act(() => { vi.advanceTimersByTime(FADE_MS); });
    expect(screen.queryByTestId("portal-fx")).toBeNull();
  });

  it("a portal link crosses with the transition (remembering the page you leave); a modified click is an ordinary link", () => {
    rememberPage("hero", "/bestiary");
    render(<PortalLink to="hero" />);
    const link = screen.getByRole("link", { name: "Enter the Hero world" });
    act(() => { vi.advanceTimersByTime(1); });
    expect(link.getAttribute("href")).toBe("/bestiary");
    fireEvent.click(link, { ctrlKey: true });
    expect(usePortal.getState().phase).toBe("idle");
    fireEvent.click(link);
    expect(usePortal.getState()).toMatchObject({ phase: "cover", to: "hero", href: "/bestiary" });
    expect(lastPage("study")).toBe("/");                                       // the page left (jsdom's location)
  });

  it("the peek shows a glimpse of the other side, as the link's description", () => {
    render(<PortalLink to="study" />);
    const link = screen.getByRole("link", { name: "Return to Study" });
    const peek = document.getElementById(link.getAttribute("aria-describedby")!)!;
    expect(peek.getAttribute("role")).toBe("tooltip");
    expect(peek.textContent).toMatch(/caught up|to review/);
  });
});
