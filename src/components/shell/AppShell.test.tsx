import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/hero" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ loading: false, user: null }) }));
vi.mock("./NavSidebar", () => ({ default: () => <aside data-testid="side" /> }));
vi.mock("./BottomNav", () => ({ default: () => <nav data-testid="bottom" /> }));
vi.mock("./CommandPaletteLoader", () => ({ default: () => null, openCommandPalette: () => {} }));

import AppShell from "./AppShell";

afterEach(cleanup);

const themeOf = (el: Element) => el.closest("[data-theme]")?.getAttribute("data-theme");

describe("the app shell", () => {
  it("keeps the sidebar and tab bar in the Study theme in Hero; only the screen goes Play", () => {
    nav.path = "/hero";
    render(<AppShell><p>arena</p></AppShell>);
    expect(themeOf(screen.getByTestId("side"))).toBe("study");
    expect(themeOf(screen.getByTestId("bottom"))).toBe("study");
    expect(themeOf(screen.getByText("arena"))).toBe("play");
  });

  it("is Study throughout outside Hero", () => {
    nav.path = "/today";
    render(<AppShell><p>today</p></AppShell>);
    expect(themeOf(screen.getByText("today"))).toBe("study");
    expect(document.querySelector('[data-theme="play"]')).toBeNull();
  });
});
