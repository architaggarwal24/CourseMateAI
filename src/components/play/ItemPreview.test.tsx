import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/champion", useSearchParams: () => new URLSearchParams("tab=inventory") }));

import ItemPreview from "./ItemPreview";
import { useHeroStore } from "@/hooks/useHero";

const base = { price: 0, level_required: 1, consumable: false, owned: true, equipped: false };
const SHOP = {
  shop_unlocked: true, level: 9, coins: 0, owned: [], equipped: { armor: "mantle" },
  items: [
    { ...base, id: "mantle", name: "Legend's Mantle", category: "armor", equipped: true, bonus: { xp_pct: 0.3 } },
    { ...base, id: "crown", name: "Gold Crown", category: "headgear", description: "A crown.", bonus: { xp_pct: 0.15, coin_pct: 0.1 }, battle: { time_sec: 8 } },
    { ...base, id: "emote_flex", name: "Flex", category: "emote", description: "Show off a little." },
  ],
};
const item = (id: string) => SHOP.items.find((i) => i.id === id)! as never;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  useHeroStore.setState({ shop: SHOP as never, previewId: "crown" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the item preview panel", () => {
  it("shows the item on the champion, its arena effect, and which study bonus would count next to what is worn", () => {
    render(<ItemPreview item={item("crown")} />);
    expect(screen.getByRole("heading", { name: "Gold Crown" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /wearing Gold Crown/ })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Arena effects" }).textContent).toMatch(/Time\s*\+8s/);
    const bonus = screen.getByRole("list", { name: "Study bonus" });
    expect(bonus.textContent).toContain("Legend's Mantle gives more (+30%)");   // XP: the mantle already gives more
    expect(bonus.textContent).toContain("Your best: it counts");               // coins: nothing worn gives any
  });

  it("an emote is acted out, with Play again, never Equip", () => {
    render(<ItemPreview item={item("emote_flex")} />);
    expect(screen.getByRole("img", { name: /acting out Flex/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Play again/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Equip" })).toBeNull();
  });

  it("Esc closes it, and is used up so the pause menu stays shut", () => {
    render(<ItemPreview item={item("crown")} />);
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(useHeroStore.getState().previewId).toBeNull();
    useHeroStore.setState({ previewId: "crown" });
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(useHeroStore.getState().previewId).toBeNull();
  });
});
