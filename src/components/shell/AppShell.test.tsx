import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/hero", replace: vi.fn() }));
const auth = vi.hoisted(() => ({ loading: false, user: { user_id: 1 } as unknown }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("./NavSidebar", () => ({ default: () => <aside data-testid="side" /> }));
vi.mock("./HeroSidebar", () => ({ default: () => <aside data-testid="hero-side" /> }));
vi.mock("./BottomNav", () => ({ default: () => <nav data-testid="bottom" /> }));
vi.mock("./CommandPaletteLoader", () => ({ default: () => null, openCommandPalette: () => {} }));

import AppShell from "./AppShell";

afterEach(() => { cleanup(); nav.replace.mockReset(); auth.user = { user_id: 1 }; });

const themeOf = (el: Element) => el.closest("[data-theme]")?.getAttribute("data-theme");

describe("the app shell", () => {
  it("two worlds: in Hero the whole frame turns Play, with the Hero panel instead of the Study sidebar", () => {
    nav.path = "/arena";
    render(<AppShell><p>arena</p></AppShell>);
    expect(screen.queryByTestId("side")).toBeNull();
    expect(themeOf(screen.getByTestId("hero-side"))).toBe("play");
    expect(themeOf(screen.getByTestId("bottom"))).toBe("play");
    expect(themeOf(screen.getByText("arena"))).toBe("play");
    expect(screen.getByText("arena").closest(".app-shell")!.getAttribute("data-world")).toBe("hero");
  });

  it("needs an account: signed out, it shows no app screen and goes to the login page, coming back here after", () => {
    auth.user = null;
    nav.path = "/study";
    window.history.replaceState(null, "", "/study?tab=quiz&doc=d1");
    render(<AppShell><p>secret</p></AppShell>);
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.getByText(/Taking you to the login page/)).toBeTruthy();
    expect(nav.replace).toHaveBeenCalledWith("/login?next=%2Fstudy%3Ftab%3Dquiz%26doc%3Dd1");
  });

  it("is Study throughout outside Hero", () => {
    nav.path = "/today";
    render(<AppShell><p>today</p></AppShell>);
    expect(themeOf(screen.getByText("today"))).toBe("study");
    expect(document.querySelector('[data-theme="play"]')).toBeNull();
  });
});
