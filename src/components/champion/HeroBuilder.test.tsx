import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMyHero } from "@/hooks/useMyHero";
import HeroBuilder, { canLower, canRaise, costOf } from "./HeroBuilder";
import { heroView } from "./heroFixture";

beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); useMyHero.getState().reset(); });

describe("your hero's workshop", () => {
  it("counts loadout points like the server, and follows the tree's rules", () => {
    const v = heroView();
    expect(costOf(v, v.build)).toBe(4);
    expect(costOf(v, { ...v.build, ultimate: "overdrive", perks: ["lucky_coin"], weaknesses: ["glass_body"] })).toBe(2 + 4 + 1 - 3);
    expect(canRaise(v, {}, "o1")).toBe(true);
    expect(canRaise(v, {}, "o2")).toBe(false);                         // tier 2 after tier 1
    expect(canRaise(v, { o1: 1, d1: 2 }, "o2")).toBe(false);            // no points left (3)
    expect(canLower(v, { o1: 1, o2: 1 }, "o1")).toBe(false);            // would strand Opening
    expect(canLower(v, { o1: 2, o2: 1 }, "o1")).toBe(true);
  });

  it("shows how a locked style is reached, saves a loadout within budget, and saves skills", async () => {
    const saveBuild = vi.fn().mockResolvedValue(true), saveTree = vi.fn().mockResolvedValue(true);
    useMyHero.setState({ view: heroView(), saveBuild, saveTree, load: vi.fn() });
    render(<HeroBuilder onEditLook={() => {}} />);
    expect(screen.getByText(/Kaien at 100% mastery \(42%\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Player Lv 12/ })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("tab", { name: /Loadout/ }));
    const ults = screen.getByRole("radiogroup", { name: "Ultimate" });
    fireEvent.click(within(ults).getByRole("radio", { name: /Overdrive/ }));
    expect(screen.getByRole("status").textContent).toMatch(/6 \/ 7/);
    fireEvent.click(screen.getByRole("radio", { name: /Riposte/ }));                // locked: nothing happens
    expect(screen.getByRole("radio", { name: /Second Wind/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: /Lucky Coin/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Lucky Coin/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save loadout" }));
    await waitFor(() => expect(saveBuild).toHaveBeenCalledWith({ style: "apprentice", passive: "second_wind", ultimate: "overdrive", perks: [], weaknesses: [] }));

    fireEvent.click(screen.getByRole("tab", { name: /Skills/ }));
    expect(screen.getByRole("button", { name: "Put a point in Opening" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Put a point in Sharpened" }));
    fireEvent.click(screen.getByRole("button", { name: "Put a point in Opening" }));
    fireEvent.click(screen.getByRole("button", { name: "Save skills" }));
    await waitFor(() => expect(saveTree).toHaveBeenCalledWith({ o1: 1, o2: 1 }));
  });
});
