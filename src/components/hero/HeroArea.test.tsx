import { Suspense, lazy } from "react";
import { MotionConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), claimQuest: vi.fn(), fetchHUD: vi.fn() }));
const nav = vi.hoisted(() => ({ query: "", push: vi.fn(), replace: vi.fn() }));

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  rawApi: { GET: api.GET, POST: api.POST, PUT: api.PUT }, claimQuest: api.claimQuest, fetchHUD: api.fetchHUD,
  fetchAchievements: vi.fn(async () => ({ achievements: [], unlocked: {}, progress: {} })),
}));
vi.mock("@/components/ui/Toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { username: "ada" } }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
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
import { useHUDStore } from "@/hooks/useHUD";
import { useChampion } from "@/hooks/useChampion";
import { useHeroStore } from "@/hooks/useHero";
import HeroArea from "./HeroArea";

const item = (over: Record<string, any>) => ({
  id: "x", category: "headgear", name: "X", description: "d", price: 100, level_required: 1, consumable: false,
  owned: false, equipped: false, can_afford: true, locked: false, quantity: null, ...over,
});
const res = (data: any) => ({ data, error: undefined, response: { ok: true, status: 200 } });

let server: any;
function startServer() {
  const champ = { champion_id: "kaien", chosen: true };
  const state: any = {
    shop_unlocked: true, level: 6, coins: 250, owned: ["hat_old"], equipped: { headgear: "hat_old" },
    category_status: {
      headgear: { name: "Headgear", icon: "🎩", description: "Hats" },
      weapon: { name: "Weapons", icon: "⚔️", description: "Swords" },
    },
    items: [
      item({ id: "hat_old", name: "Old Hat", price: 0, owned: true, equipped: true }),
      item({ id: "hat_new", name: "New Hat", price: 200, description: "Brand new" }),
      item({ id: "hat_crown_gold", name: "Solaris Crown", price: 2000, owned: true, description: "Gold" }),
    ],
  };
  server = { state, champ };
  const champState = () => ({ ...champ, champions: ["kaien", "asha", "brak", "mira", "vex", "thorne"], loadout: { armor: null, headgear: state.equipped.headgear ?? null, weapon: null, pet: null } });
  api.GET.mockImplementation(async (path: string) => {
    if (path === "/shop") return res(structuredClone(state));
    if (path === "/avatar/champion") return res(champState());
    throw new Error(path);
  });
  api.PUT.mockImplementation(async (path: string, { body }: any) => {
    if (path !== "/avatar/champion") throw new Error(path);
    champ.champion_id = body.champion_id; champ.chosen = true;
    return res(champState());
  });
  api.fetchHUD.mockImplementation(async () => ({
    progress: { current_level: 6, total_xp: 900, coins: state.coins, xp_into_level: 40, xp_to_next: 100, streak_days: 4, streak_freezes: 0 },
    quests: [], shop: {}, buffs: {}, consumable_inventory: {}, guest_mode: false,
  }));
  api.POST.mockImplementation(async (path: string, { body }: any) => {
    if (path === "/shop/equip") {
      const it = state.items.find((i: any) => i.id === body.item_id);
      state.items.forEach((i: any) => { if (i.category === it.category) i.equipped = i.id === it.id; });
      state.equipped[it.category] = it.id;
      return res({ ok: true, equipped: state.equipped });
    }
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
  useChampion.getState().reset();
  useHUDStore.setState({ guestMode: false, coins: 250, level: 6, xp: 900, xpInto: 40, xpToNext: 100, streakDays: 4, quests: [], buffs: {}, _epoch: 0, _seq: 0, _lastRefresh: Date.now() });
  startServer();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("<HeroArea />", () => {
  it("keeps the header (level, XP bar, coins, streak) on top of every tab", async () => {
    const { rerender } = render(<HeroArea />);
    await screen.findByText("Headgear", { selector: "h2" });
    for (const q of ["tab=shop", "tab=inventory", "tab=champion", "tab=quests", "tab=arena", ""]) {
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
      ["Quests", "Arena", "Bestiary", "Shop", "Inventory", "Champion", "Achievements"],
    );
    expect(within(nav_).getByRole("link", { name: "Quests" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav_).getByRole("link", { name: "Shop" }).getAttribute("aria-current")).toBeNull();
    expect(within(nav_).getByRole("link", { name: "Shop" }).getAttribute("href")).toBe("/hero?tab=shop");
  });

  it("buying an item updates coins, inventory and the champion preview with no reload", async () => {
    const { rerender } = render(<HeroArea />);
    await screen.findByText("New Hat");
    const card = () => screen.getByText("New Hat").closest("li")!;

    // Try it on: the header's champion and the shop's both show it.
    fireEvent.click(within(card()).getByRole("button", { name: "Try on New Hat" }));
    expect(screen.getByRole("img", { name: "Your champion, Kaien, trying on New Hat" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Kaien, trying on New Hat" })).toBeTruthy();
    expect(screen.getByTestId("shop-preview-name").textContent).toContain("New Hat");

    const shopReads = () => api.GET.mock.calls.filter(([p]) => p === "/shop").length;
    const readsBefore = shopReads();
    fireEvent.click(within(card()).getByRole("button", { name: "Buy" }));

    // Coins, the card and the preview change from the purchase's own answer ...
    await vi.waitFor(() => expect(coins()).toBe("50"));
    expect(within(card()).getByRole("button", { name: "Equip" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Your champion, Kaien, trying on New Hat" })).toBeTruthy();

    // ... and the inventory tab (same page, same stores) already lists it, without the page being reloaded.
    nav.query = "tab=inventory";
    rerender(<HeroArea />);
    expect(screen.getByTestId("inventory-count").textContent).toBe("3 items owned");
    expect(screen.getByText("New Hat")).toBeTruthy();
    expect(coins()).toBe("50");

    // The quiet confirmation happened, and it agrees with what was shown.
    await vi.waitFor(() => expect(shopReads()).toBeGreaterThan(readsBefore));
    expect(coins()).toBe("50");
    expect(screen.getByTestId("inventory-count").textContent).toBe("3 items owned");
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

  describe("the Champion tab", () => {
    beforeEach(() => { nav.query = "tab=champion"; });

    it("old Avatar and Hero Forge links open the Champion tab", async () => {
      for (const q of ["tab=avatar", "tab=forge"]) {
        nav.query = q;
        nav.replace.mockClear();
        render(<HeroArea />);
        expect(within(screen.getByRole("navigation", { name: "Hero" })).getByRole("link", { name: "Champion" }).getAttribute("aria-current")).toBe("page");
        await screen.findByRole("radiogroup", { name: "Choose your champion" });
        expect(nav.replace).toHaveBeenCalledWith("/hero?tab=champion");
        cleanup();
      }
    });

    it("loads the account's champion, and picking another saves it on the account and shows it everywhere", async () => {
      server.champ.champion_id = "mira";
      render(<HeroArea />);
      const roster = await screen.findByRole("radiogroup", { name: "Choose your champion" });
      await vi.waitFor(() => expect(within(roster).getByRole("radio", { checked: true }).textContent).toContain("Mira"));
      expect(screen.getByRole("img", { name: "Your champion, Mira" })).toBeTruthy();

      fireEvent.click(within(roster).getByRole("radio", { name: /Thorne/ }));
      expect(api.PUT).toHaveBeenCalledWith("/avatar/champion", { body: { champion_id: "thorne" } });
      expect(screen.getByRole("img", { name: "Your champion, Thorne" })).toBeTruthy();       // the header, at once
      await vi.waitFor(() => expect(useChampion.getState()).toMatchObject({ championId: "thorne", chosen: true }));
      expect(screen.getByText("Knight of the Last Chapter", { exact: false })).toBeTruthy();
    });

    it("the roster is a radio group the arrow keys move through", async () => {
      render(<HeroArea />);
      const roster = await screen.findByRole("radiogroup", { name: "Choose your champion" });
      await vi.waitFor(() => expect(within(roster).getByRole("radio", { checked: true }).textContent).toContain("Kaien"));
      fireEvent.keyDown(within(roster).getByRole("radio", { checked: true }), { key: "ArrowRight" });
      await vi.waitFor(() => expect(within(roster).getByRole("radio", { checked: true }).textContent).toContain("Asha"));
    });

    it("wears a skin from the loadout, and shows the live preview in idle, attack or win", async () => {
      render(<HeroArea />);
      fireEvent.click(await screen.findByRole("button", { name: /Head piece/ }));
      fireEvent.click(screen.getByRole("button", { name: "Wear Solaris Crown" }));
      expect(api.POST).toHaveBeenCalledWith("/shop/equip", { body: { item_id: "hat_crown_gold" } });
      await vi.waitFor(() => expect(screen.getByRole("img", { name: /^Kaien, wearing Solaris Crown \(idle\)$/ })).toBeTruthy());
      const anims = screen.getByRole("radiogroup", { name: "Preview animation" });
      fireEvent.click(within(anims).getByRole("radio", { name: "Win" }));
      expect(within(anims).getByRole("radio", { name: "Win" }).getAttribute("aria-checked")).toBe("true");
      expect(screen.getByRole("img", { name: /^Kaien, wearing Solaris Crown \(win\)$/ })).toBeTruthy();
    });

    it("every sprite has a name or is hidden from screen readers", async () => {
      render(<HeroArea />);
      await screen.findByRole("radiogroup", { name: "Choose your champion" });
      const canvases = [...document.querySelectorAll("canvas")];
      expect(canvases.length).toBeGreaterThan(6);
      for (const c of canvases) {
        const named = c.getAttribute("role") === "img" && !!c.getAttribute("aria-label");
        expect(named || c.getAttribute("aria-hidden") === "true", c.outerHTML).toBe(true);
      }
    });

    it("reduced motion freezes every sprite on one frame", async () => {
      render(<MotionConfig reducedMotion="always"><HeroArea /></MotionConfig>);
      await screen.findByRole("radiogroup", { name: "Choose your champion" });
      const sprites = [...document.querySelectorAll("canvas[data-playing]")];
      expect(sprites.length).toBeGreaterThan(6);
      for (const c of sprites) expect(c.getAttribute("data-playing")).toBe("false");
      cleanup();
      render(<HeroArea />);
      await screen.findByRole("radiogroup", { name: "Choose your champion" });
      expect(document.querySelector("canvas[data-playing='true']")).not.toBeNull();
    });
  });
});

describe("<HeroArea />: champion levels and mastery skins (Phase 3 Stage 2)", () => {
  const progress = (over: Record<string, any> = {}) => ({
    xp: 120, level: 2, level_xp: 100, next_level_xp: 250, battles: 4, wins: 2,
    mastery: [{ id: "mastery_kaien_head", slot: "headgear", level: 3 }, { id: "mastery_kaien_weapon", slot: "weapon", level: 6 }],
    kit: { passive: { name: "Riposte", text: "A right Guard hits back." }, ultimate: { name: "Blade Storm", text: "Two right answers hit twice." } },
    ...over,
  });
  beforeEach(() => {
    server.champ.progress = { kaien: progress(), mira: progress({ level: 5, xp: 760, level_xp: 700, next_level_xp: 1000, mastery: [] }) };
    server.state.items.push(
      item({ id: "mastery_kaien_head", name: "Ninth Page Kabuto", price: 0, owned: true, mastery: { champion: "kaien", level: 3 } }),
      item({ id: "mastery_mira_head", name: "Archivist Hood", price: 0, owned: true, mastery: { champion: "mira", level: 3 } }),
      item({ id: "mastery_kaien_weapon", category: "weapon", name: "Last Page Edge", price: 0, mastery: { champion: "kaien", level: 6 } }),
    );
  });

  it("the shop never sells mastery skins", async () => {
    nav.query = "tab=shop";
    render(<HeroArea />);
    await screen.findByText("New Hat");
    expect(screen.queryByText("Ninth Page Kabuto")).toBeNull();
    expect(screen.queryByText("Archivist Hood")).toBeNull();
  });

  it("the Champion tab shows the kit, the level and which mastery skins are unlocked", async () => {
    nav.query = "tab=champion";
    render(<HeroArea />);
    const kit = await screen.findByTestId("champion-kit");
    expect(within(kit).getByText(/Passive · Riposte/)).toBeTruthy();
    expect(within(kit).getByText(/Ultimate · Blade Storm/)).toBeTruthy();
    expect(within(kit).getByText("Kaien level 2, 120 of 250 XP")).toBeTruthy();
    const list = within(kit).getByRole("list", { name: "Kaien's mastery skins" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Unlocked"), expect.stringContaining("Unlocks at Lv 6")]);
    const roster = screen.getByRole("radiogroup", { name: "Choose your champion" });
    expect(within(within(roster).getByRole("radio", { name: /Mira/ })).getByText("Level 5")).toBeTruthy();          // Mira's card
  });

  it("the loadout offers a mastery skin only to the champion that earned it", async () => {
    nav.query = "tab=champion";
    render(<HeroArea />);
    fireEvent.click(await screen.findByRole("button", { name: /Head piece/ }));
    expect(screen.getByRole("button", { name: "Wear Ninth Page Kabuto" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Wear Archivist Hood" })).toBeNull();
  });
});
