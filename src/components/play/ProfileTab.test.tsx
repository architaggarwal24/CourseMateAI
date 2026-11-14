import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/adventurer", useSearchParams: () => new URLSearchParams("") }));

import ProfileTab from "./ProfileTab";
import { useHeroStore } from "@/hooks/useHero";
import { useHeroPrefs } from "@/hooks/useHeroPrefs";
import { useSound } from "@/lib/sound/chip";

const item = (over: Record<string, unknown>) => ({ category: "headgear", price: 100, level_required: 1, consumable: false, owned: true, equipped: true, ...over });
const SHOP = {
  shop_unlocked: true, level: 9, coins: 50, owned: [],
  equipped: { armor: "mantle", headgear: "crown", pet: "owl" },
  items: [
    item({ id: "mantle", name: "Legend's Mantle", category: "armor", bonus: { xp_pct: 0.3, coin_pct: 0.2 }, battle: { damage_pct: 0.1 } }),
    item({ id: "crown", name: "Gold Crown", bonus: { xp_pct: 0.15, coin_pct: 0.1 }, battle: { time_sec: 8 } }),
    item({ id: "owl", name: "Owl", category: "pet", bonus: { xp_pct: 0.08, arena_hints: 1 } }),
  ],
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 })));
  useHeroStore.setState({ shop: SHOP as never, loading: false });
  useSound.setState({ loaded: true, on: true, music: true });
  useHeroPrefs.setState({ loaded: true, cursor: true, menuSounds: true, lobbyMusic: false, scanlines: false, nudge: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the hero profile", () => {
  it("study bonuses: one line per stat, the best item's value, and which items don't add to it", () => {
    render(<ProfileTab />);
    const bonuses = screen.getByRole("list", { name: "Study bonuses" });
    const rows = within(bonuses).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".hero-bonus")?.textContent)).toEqual(["XP+30%", "Coins+20%", "Hints+1"]);
    expect(rows[0].textContent).toContain("Legend's Mantle");
    expect(rows[0].textContent).toMatch(/Not counted: Gold Crown \+15%, Owl \+8%/);
  });

  it("the arena totals of what is worn", () => {
    render(<ProfileTab />);
    const arena = screen.getByTestId("arena-gear");
    expect(arena.textContent).toMatch(/Damage\s*\+10%/);
    expect(arena.textContent).toMatch(/Time\s*\+8s/);
  });

  it("the Hero world's settings: sound, music and the world's own switches, kept as you set them", () => {
    render(<ProfileTab />);
    const settings = screen.getByRole("region", { name: "Hero settings" });
    fireEvent.click(within(settings).getByRole("button", { name: "Sound" }));
    expect(useSound.getState().on).toBe(false);
    fireEvent.click(within(settings).getByRole("button", { name: "CRT scanlines" }));
    expect(useHeroPrefs.getState().scanlines).toBe(true);
  });
});
