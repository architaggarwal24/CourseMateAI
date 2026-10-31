import { Suspense, lazy, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), claimQuest: vi.fn(), fetchHUD: vi.fn() }));
const nav = vi.hoisted(() => ({ query: "", push: vi.fn() }));
const forge = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  rawApi: { GET: api.GET, POST: api.POST }, claimQuest: api.claimQuest, fetchHUD: api.fetchHUD,
  fetchAchievements: vi.fn(async () => ({ achievements: [], unlocked: {}, progress: {} })),
}));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { username: "ada" } }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
  usePathname: () => "/hero",
}));
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<any> }>) => {
    const Lazy = lazy(loader);
    return (props: any) => <Suspense fallback={null}><Lazy {...props} /></Suspense>;
  },
}));
vi.mock("@/components/arena/ArenaArea", () => ({ default: () => <div>arena</div> }));
// The forge is stubbed: all that matters here is that it reports unsaved edits to the area.
vi.mock("./ForgeTab", async () => {
  const { useHeroStore } = await import("@/hooks/useHero");
  return {
    default: () => {
      useEffect(() => { useHeroStore.getState().setForgeGuard({ dirty: true, save: forge.save }); return () => useHeroStore.getState().setForgeGuard(null); }, []);
      return <div>forge</div>;
    },
  };
});

import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import HeroArea from "./HeroArea";

const item = (over: Record<string, any>) => ({
  id: "x", category: "headgear", name: "X", description: "d", price: 100, level_required: 1, consumable: false,
  owned: false, equipped: false, can_afford: true, locked: false, quantity: null, ...over,
});
const res = (data: any) => ({ data, error: undefined, response: { ok: true, status: 200 } });

function startServer() {
  const state: any = {
    shop_unlocked: true, level: 6, coins: 250, owned: ["hat_old"], equipped: { headgear: "hat_old" },
    category_status: {
      headgear: { name: "Headgear", icon: "🎩", description: "Hats" },
      weapon: { name: "Weapons", icon: "⚔️", description: "Swords" },
    },
    items: [
      item({ id: "hat_old", name: "Old Hat", price: 0, owned: true, equipped: true }),
      item({ id: "hat_new", name: "New Hat", price: 200, description: "Brand new" }),
    ],
  };
  api.GET.mockImplementation(async (path: string) => { if (path === "/shop") return res(structuredClone(state)); throw new Error(path); });
  api.fetchHUD.mockImplementation(async () => ({
    progress: { current_level: 6, total_xp: 900, coins: state.coins, xp_into_level: 40, xp_to_next: 100, streak_days: 4, streak_freezes: 0 },
    quests: [], shop: {}, buffs: {}, consumable_inventory: {}, guest_mode: false,
  }));
  api.POST.mockImplementation(async (path: string, { body }: any) => {
    if (path !== "/shop/purchase") throw new Error(path);
    const it = state.items.find((i: any) => i.id === body.item_id);
    state.coins -= it.price; it.owned = true; state.owned.push(it.id);
    return res({ ok: true, message: "Purchased" });
  });
}

const coins = () => screen.getByTestId("hero-coins").textContent;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);   // (jsdom has no canvas; the avatar just draws nothing)
  nav.query = "tab=shop";
  useHeroStore.getState().reset();
  useHUDStore.setState({ guestMode: false, coins: 250, level: 6, xp: 900, xpInto: 40, xpToNext: 100, streakDays: 4, quests: [], buffs: {}, _epoch: 0, _seq: 0, _lastRefresh: Date.now() });
  startServer();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("<HeroArea />", () => {
  it("keeps the header (level, XP bar, coins, streak) on top of every tab", async () => {
    const { rerender } = render(<HeroArea />);
    await screen.findByText("Headgear", { selector: "h2" });
    for (const q of ["tab=shop", "tab=inventory", "tab=avatar", "tab=quests", "tab=arena", ""]) {
      nav.query = q;
      rerender(<HeroArea />);
      const header = screen.getByTestId("hero-header");
      expect(within(header).getByTestId("hero-level").textContent).toBe("LV 6");
      expect(within(header).getByRole("progressbar", { name: "XP to next level" }).getAttribute("aria-valuenow")).toBe("40");
      expect(coins()).toBe("250");
      expect(within(header).getByTestId("hero-streak").textContent).toBe("4");
    }
  });

  it("one tab is current, and an unknown tab is the quests tab", async () => {
    nav.query = "tab=nonsense";
    render(<HeroArea />);
    const nav_ = screen.getByRole("navigation", { name: "Hero" });
    expect(within(nav_).getAllByRole("link").map((l) => l.textContent)).toEqual(
      ["Quests", "Arena", "Shop", "Inventory", "Avatar", "Hero Forge", "Achievements"],
    );
    expect(within(nav_).getByRole("link", { name: "Quests" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav_).getByRole("link", { name: "Shop" }).getAttribute("aria-current")).toBeNull();
    expect(within(nav_).getByRole("link", { name: "Shop" }).getAttribute("href")).toBe("/hero?tab=shop");
  });

  it("buying an item updates coins, inventory and the avatar preview with no reload", async () => {
    const { rerender } = render(<HeroArea />);
    await screen.findByText("New Hat");
    const card = () => screen.getByText("New Hat").closest("li")!;

    // Try it on: the header's avatar and the shop's both show it.
    fireEvent.click(within(card()).getByRole("button", { name: "Try on New Hat" }));
    expect(screen.getByRole("img", { name: "Your hero, trying on New Hat" })).toBeTruthy();
    expect(screen.getByTestId("shop-preview-name").textContent).toContain("New Hat");

    const shopReads = () => api.GET.mock.calls.filter(([p]) => p === "/shop").length;
    const readsBefore = shopReads();
    fireEvent.click(within(card()).getByRole("button", { name: "Buy" }));

    // Coins, the card and the preview change from the purchase's own answer ...
    await vi.waitFor(() => expect(coins()).toBe("50"));
    expect(within(card()).getByRole("button", { name: "Equip" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Your hero, trying on New Hat" })).toBeTruthy();

    // ... and the inventory tab (same page, same stores) already lists it, without the page being reloaded.
    nav.query = "tab=inventory";
    rerender(<HeroArea />);
    expect(screen.getByTestId("inventory-count").textContent).toBe("2 items owned");
    expect(screen.getByText("New Hat")).toBeTruthy();
    expect(coins()).toBe("50");

    // The quiet confirmation happened, and it agrees with what was shown.
    await vi.waitFor(() => expect(shopReads()).toBeGreaterThan(readsBefore));
    expect(coins()).toBe("50");
    expect(screen.getByTestId("inventory-count").textContent).toBe("2 items owned");
  });

  it("rarity: an item has the same rarity in the shop and in the inventory", async () => {
    const { rerender } = render(<HeroArea />);
    await screen.findByText("New Hat");
    const rarity = (id: string) => document.querySelector(`[data-item-id="${id}"]`)?.getAttribute("data-rarity");
    expect(rarity("hat_old")).toBe("common");
    expect(rarity("hat_new")).toBe("common");                                // 200 coins: below the "rare" step
    nav.query = "tab=inventory";
    rerender(<HeroArea />);
    expect(rarity("hat_old")).toBe("common");
    expect(document.querySelector('[data-item-id="hat_new"]')).toBeNull();   // not owned yet: not in the inventory
  });

  describe("leaving the forge with unsaved edits", () => {
    beforeEach(() => { nav.query = "tab=forge"; forge.save.mockResolvedValue(true); });
    const tabLink = (name: string) => within(screen.getByRole("navigation", { name: "Hero" })).getByRole("link", { name });

    it("asks first; Keep editing stays", async () => {
      render(<HeroArea />);
      await screen.findByText("forge");
      await vi.waitFor(() => expect(useHeroStore.getState().forgeGuard?.dirty).toBe(true));
      fireEvent.click(tabLink("Shop"));
      expect(await screen.findByRole("alertdialog", { name: "Unsaved changes" })).toBeTruthy();
      expect(nav.push).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(nav.push).not.toHaveBeenCalled();
    });

    it("Discard leaves without saving", async () => {
      render(<HeroArea />);
      await screen.findByText("forge");
      await vi.waitFor(() => expect(useHeroStore.getState().forgeGuard?.dirty).toBe(true));
      fireEvent.click(tabLink("Inventory"));
      fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
      expect(nav.push).toHaveBeenCalledWith("/hero?tab=inventory");
      expect(forge.save).not.toHaveBeenCalled();
    });

    it("Save & Exit saves, then leaves; a failed save stays", async () => {
      render(<HeroArea />);
      await screen.findByText("forge");
      await vi.waitFor(() => expect(useHeroStore.getState().forgeGuard?.dirty).toBe(true));
      fireEvent.click(tabLink("Shop"));
      forge.save.mockResolvedValueOnce(false);
      fireEvent.click(await screen.findByRole("button", { name: /Save & Exit/ }));
      await vi.waitFor(() => expect(forge.save).toHaveBeenCalledTimes(1));
      expect(nav.push).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole("button", { name: /Save & Exit/ }));
      await vi.waitFor(() => expect(nav.push).toHaveBeenCalledWith("/hero?tab=shop"));
      expect(forge.save).toHaveBeenCalledTimes(2);
    });

    it("clean forge: tabs just navigate", async () => {
      render(<HeroArea />);
      await screen.findByText("forge");
      useHeroStore.getState().setForgeGuard({ dirty: false, save: forge.save });
      fireEvent.click(tabLink("Shop"));
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });
});
