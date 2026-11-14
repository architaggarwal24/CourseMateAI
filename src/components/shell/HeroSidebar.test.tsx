import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ path: "/arena", query: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useSearchParams: () => new URLSearchParams(nav.query), useRouter: () => ({ push: vi.fn() }) }));

import HeroSidebar from "./HeroSidebar";
import { useHUDStore } from "@/hooks/useHUD";

beforeEach(() => {
  nav.path = "/arena"; nav.query = "";
  document.documentElement.dataset.sidebar = "expanded";
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useHUDStore.setState({ level: 6, coins: 320, xpInto: 120, xpToNext: 400, streakDays: 4 } as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const menu = () => screen.getByRole("navigation", { name: "Main" });

describe("the Hero panel (the two worlds, Stage 1)", () => {
  it("holds your champion's status, the Hero menu with Champion's screens under it, and the portal back to Study", () => {
    render(<HeroSidebar />);
    const status = screen.getByRole("region", { name: "Hero status" });
    expect(within(status).getByTestId("hero-panel-level").textContent).toBe("LV 6");
    expect(within(status).getByTestId("hero-panel-coins").textContent).toBe("320");
    expect(within(status).getByRole("progressbar", { name: "XP to next level" }).getAttribute("aria-valuenow")).toBe("30");
    expect(within(status).getByRole("img", { name: /^Your champion, / })).toBeTruthy();
    const links = within(menu()).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Arena", "/arena"], ["Quests", "/quests"], ["Bestiary", "/bestiary"], ["Champion", "/champion"],
      ["Inventory", "/champion?tab=inventory"], ["Forge", "/champion?tab=forge"], ["Shop", "/champion?tab=shop"],
      ["Achievements", "/champion?tab=achievements"], ["Mastery", "/champion?tab=mastery"],
    ]);
    expect(screen.getByRole("link", { name: "Return to Study" }).getAttribute("href")).toBe("/today");
    expect(screen.getByRole("button", { name: "Sound" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Hero profile" }).getAttribute("href")).toBe("/adventurer");   // beside the sound switch
  });

  it("the profile button is marked current on the profile page", () => {
    nav.path = "/adventurer";
    render(<HeroSidebar />);
    expect(screen.getByRole("link", { name: "Hero profile" }).getAttribute("aria-current")).toBe("page");
  });

  it("marks where you are, Champion's screens by their tab", () => {
    const current = () => within(menu()).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page").map((l) => l.textContent);
    render(<HeroSidebar />);
    expect(current()).toEqual(["Arena"]);
    cleanup();
    nav.path = "/champion";
    render(<HeroSidebar />);
    expect(current()).toEqual(["Champion"]);
    cleanup();
    nav.query = "tab=shop";
    render(<HeroSidebar />);
    expect(current()).toEqual(["Shop"]);
  });

  it("the arrow keys walk the menu like a game's, wrapping around; Home and End jump to its ends", () => {
    render(<HeroSidebar />);
    const links = within(menu()).getAllByRole("link");
    links[0].focus();
    fireEvent.keyDown(links[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(links[1]);
    fireEvent.keyDown(links[1], { key: "ArrowUp" });
    fireEvent.keyDown(links[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(links.at(-1));
    fireEvent.keyDown(links.at(-1)!, { key: "Home" });
    expect(document.activeElement).toBe(links[0]);
    fireEvent.keyDown(links[0], { key: "End" });
    expect(document.activeElement).toBe(links.at(-1));
  });
});
