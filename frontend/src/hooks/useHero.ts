import { create } from "zustand";
import { toast } from "@/components/ui/Toast";
import { claimQuest, parseApiError, rawApi } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";

/**
 * The Hero area's one source of truth for what the hero owns, wears and can afford.
 *
 *   coins, level, XP, streak, quests, buffs -> useHUDStore (GET /hud)
 *   items, owned, equipped, previewed item  -> here        (GET /shop)
 *
 * The header, shop, inventory, avatar, forge and quests all read these two stores, and every change (buy, equip,
 * unequip, use, claim) goes through the actions below. An action patches the local state straight from what it
 * already knows (so the screen reacts at once), then quietly re-reads the server to confirm. A re-read that
 * started before the latest change is dropped (see useHUDStore._epoch and `shopEpoch` here), so an old answer can
 * never flip the screen back to a state it has already left.
 */

export type ShopItem = Record<string, any> & { id: string; category: string };
export interface ShopState {
  shop_unlocked: boolean;
  level: number;
  coins: number;
  owned: string[];
  equipped: Record<string, string>;
  items: ShopItem[];
  category_status?: Record<string, any>;
  [key: string]: any;
}

/** The "forge" tab tells the Hero area about unsaved edits so it can ask before leaving. */
export interface ForgeGuard { dirty: boolean; save: () => Promise<boolean> }

interface HeroState {
  shop: ShopState | null;
  /** True only until the first answer (later re-reads are silent: no spinner flash). */
  loading: boolean;
  /** The item being tried on (shop / avatar): shown on every avatar preview in the area. */
  previewId: string | null;
  forgeGuard: ForgeGuard | null;
  /** Ids of quests / items with a request in flight (to disable their buttons). */
  pending: Record<string, true>;
  _shopEpoch: number;

  loadShop: () => Promise<void>;
  /** Re-read /shop and /hud together; calls overlapping an unfinished one are merged into a single extra pass. */
  reconcile: () => Promise<void>;
  setPreview: (id: string | null) => void;
  togglePreview: (id: string) => void;
  setForgeGuard: (guard: ForgeGuard | null) => void;

  purchase: (item: ShopItem) => Promise<boolean>;
  equip: (item: ShopItem) => Promise<boolean>;
  unequip: (slot: string, name?: string) => Promise<boolean>;
  toggleEquip: (item: ShopItem) => Promise<boolean>;
  /** (internal) wear or remove `item`. */
  toggleEquipTo: (item: ShopItem, wearing: boolean) => Promise<boolean>;
  useItem: (item: ShopItem) => Promise<boolean>;
  claim: (questType: string) => Promise<boolean>;
  /** Forge saved a new look: the server's equipped slots changed under us. */
  afterForgeSave: () => Promise<void>;
  reset: () => void;
}

const RESULT_FALLBACK = "Not allowed right now";

const hud = () => useHUDStore.getState();

/** Make `coins` (and the `level` the server reports with it) the same number everywhere. */
function setCoins(coins: number) {
  useHUDStore.setState({ coins });
}

// ── Pure helpers (exported for the screens and the tests) ──────────────────────────────────────────────────────

/** What the avatar looks like while `previewId` is tried on: the equipped set with that item in its slot. */
export function previewEquipped(shop: ShopState | null, previewId: string | null): Record<string, string> {
  const base = shop?.equipped ?? {};
  if (!previewId || !shop) return base;
  const item = shop.items.find((i) => i.id === previewId);
  return item ? { ...base, [item.category]: item.id } : base;
}

/** Inventory tab -> which owned items it lists. */
export const INVENTORY_TABS = [
  { id: "equipment", name: "Equipment", icon: "⚔️", match: (i: ShopItem) => ["headgear", "armor", "weapon"].includes(i.category) },
  { id: "pets", name: "Pets", icon: "🐱", match: (i: ShopItem) => i.category === "pet" },
  { id: "consumables", name: "Consumables", icon: "🧪", match: (i: ShopItem) => ["potion", "special"].includes(i.category) && !!i.consumable && (i.quantity ?? 0) > 0 },
  { id: "titles", name: "Titles", icon: "🏆", match: (i: ShopItem) => i.category === "title" },
] as const;

export function ownedItems(shop: ShopState | null): ShopItem[] {
  return (shop?.items ?? []).filter((i) => i.owned);
}

function mapItems(shop: ShopState, fn: (item: ShopItem) => ShopItem): ShopState {
  return { ...shop, items: shop.items.map(fn) };
}

/** The shop after buying `itemId` for `price`: coins down, the item owned (or one more of it), affordability redone. */
export function afterPurchase(shop: ShopState, itemId: string, price: number, charged = true): ShopState {
  const coins = charged ? Math.max(0, shop.coins - price) : shop.coins;
  const owned = shop.owned.includes(itemId) ? shop.owned : [...shop.owned, itemId];
  return {
    ...mapItems(shop, (i) => {
      const bought = i.id === itemId;
      const next: ShopItem = { ...i, can_afford: !!i.can_afford && Number(i.price) <= coins };
      if (!bought) return next;
      return i.consumable
        ? { ...next, owned: true, quantity: (i.quantity ?? 0) + (charged ? 1 : 0) }
        : { ...next, owned: true, can_afford: false };
    }),
    coins,
    owned,
  };
}

/** The shop after wearing `item` (or taking off whatever is in its slot when `item` is already worn). */
export function afterEquipToggle(shop: ShopState, item: ShopItem, wearing: boolean): ShopState {
  const equipped = { ...shop.equipped };
  if (wearing) equipped[item.category] = item.id;
  else delete equipped[item.category];
  return {
    ...mapItems(shop, (i) => (i.category !== item.category ? i : { ...i, equipped: wearing && i.id === item.id })),
    equipped,
  };
}

export function afterUnequip(shop: ShopState, slot: string): ShopState {
  const equipped = { ...shop.equipped };
  delete equipped[slot];
  return { ...mapItems(shop, (i) => (i.category === slot ? { ...i, equipped: false } : i)), equipped };
}

/** The shop after using a consumable: one fewer. */
export function afterUse(shop: ShopState, itemId: string): ShopState {
  return mapItems(shop, (i) => (i.id === itemId ? { ...i, quantity: Math.max(0, (i.quantity ?? 0) - 1) } : i));
}

// ── The store ──────────────────────────────────────────────────────────────────────────────────────────────

let reconciling: Promise<void> | null = null;
let reconcileAgain = false;

export const useHeroStore = create<HeroState>((set, get) => {
  /** A change was made locally: older answers still on their way are out of date. */
  const changed = () => {
    set((s) => ({ _shopEpoch: s._shopEpoch + 1 }));
    hud().markChanged();
  };

  const applyShop = (data: ShopState) => {
    set({ shop: data, loading: false });
    setCoins(data.coins);
  };

  const readShop = async () => {
    const epoch = get()._shopEpoch;
    try {
      const { data, response } = await rawApi.GET("/shop");
      if (!response.ok || !data) return;
      if (get()._shopEpoch !== epoch) return;        // something changed while we waited: this answer is old
      applyShop(data as unknown as ShopState);
    } catch (e) { console.error("Shop load error:", e); }
  };

  const withPending = async <T,>(key: string, run: () => Promise<T>): Promise<T> => {
    set((s) => ({ pending: { ...s.pending, [key]: true } }));
    try { return await run(); }
    finally { set((s) => { const p = { ...s.pending }; delete p[key]; return { pending: p }; }); }
  };

  /** Shared tail of every game action: the answer `{ok, reason}` or a failed request, as a toast. Returns true on success. */
  const settle = (response: Response, data: unknown, error: unknown, onOk: (result: any) => void): boolean => {
    const result: any = data ?? error;
    if (response.ok && result?.ok) { onOk(result); return true; }
    if (response.ok) toast.error(result?.reason || RESULT_FALLBACK);       // the game said no (level, stock, funds ...)
    else toast.apiError(parseApiError(response.status, error));
    return false;
  };

  return {
    shop: null,
    loading: true,
    previewId: null,
    forgeGuard: null,
    pending: {},
    _shopEpoch: 0,

    loadShop: async () => {
      await readShop();
      set({ loading: false });
    },

    reconcile: async () => {
      if (reconciling) { reconcileAgain = true; return reconciling; }
      reconciling = (async () => {
        do {
          reconcileAgain = false;
          await Promise.all([readShop(), hud().refresh()]);
        } while (reconcileAgain);
      })().finally(() => { reconciling = null; });
      return reconciling;
    },

    setPreview: (id) => set({ previewId: id }),
    togglePreview: (id) => set((s) => ({ previewId: s.previewId === id ? null : id })),
    setForgeGuard: (guard) => set({ forgeGuard: guard }),

    purchase: async (item) => {
      const { guestMode, coins } = hud();
      if (guestMode) { toast.error("Please login to purchase items"); return false; }
      if (coins < Number(item.price)) { toast.error(`Not enough coins! Need ${Number(item.price) - coins} more 🪙`); return false; }
      return withPending(item.id, async () => {
        try {
          const { data, error, response } = await rawApi.POST("/shop/purchase", { body: { item_id: item.id } });
          return settle(response, data, error, (result) => {
            toast.success(`${item.name} purchased! 🎉`);
            const shop = get().shop;
            if (shop) {
              changed();
              const charged = result.message !== "Already owned";     // the server refused to charge twice
              applyShop(afterPurchase(shop, item.id, Number(item.price), charged));
            }
            void get().reconcile();
          });
        } catch (e) { toast.apiError(e, { onRetry: () => { void get().purchase(item); } }); return false; }
      });
    },

    equip: async (item) => get().toggleEquipTo(item, true),
    unequip: async (slot, name) => {
      const shop = get().shop;
      const item = shop?.items.find((i) => i.category === slot && i.equipped);
      return get().toggleEquipTo(item ?? { id: "", category: slot, name: name ?? "Item" }, false);
    },
    toggleEquip: async (item) => get().toggleEquipTo(item, !item.equipped),

    // (internal) wear / remove `item`, optimistically; put the old state back if the server refuses.
    toggleEquipTo: async (item: ShopItem, wearing: boolean) => {
      if (hud().guestMode) { toast.error("Please login to equip items"); return false; }
      const before = get().shop;
      if (before) { changed(); set({ shop: afterEquipToggle(before, item, wearing) }); }
      if (wearing && get().previewId === item.id) set({ previewId: null });
      try {
        const { data, error, response } = wearing
          ? await rawApi.POST("/shop/equip", { body: { item_id: item.id } })
          : await rawApi.POST("/shop/unequip", { body: { slot: item.category } });
        const ok = settle(response, data, error, () => {
          toast.success(wearing ? `${item.name} equipped! ⚡` : `${item.name} unequipped!`);
        });
        if (!ok && before) { changed(); set({ shop: before }); }
        void get().reconcile();
        return ok;
      } catch (e) {
        if (before) { changed(); set({ shop: before }); }
        toast.apiError(e, { onRetry: () => { void get().toggleEquipTo(item, wearing); } });
        void get().reconcile();
        return false;
      }
    },

    useItem: async (item) => {
      if (hud().guestMode) { toast.error("Please login to use items"); return false; }
      return withPending(item.id, async () => {
        try {
          const { data, error, response } = await rawApi.POST("/items/use", { body: { item_id: item.id } });
          return settle(response, data, error, (result) => {
            toast.success(`${item.name} used! ${result.message || "Effect applied."}`);
            const shop = get().shop;
            if (shop) { changed(); set({ shop: afterUse(shop, item.id) }); }
            void get().reconcile();
          });
        } catch (e) { toast.apiError(e, { onRetry: () => { void get().useItem(item); } }); return false; }
      });
    },

    claim: async (questType) => {
      if (hud().guestMode) { toast.error("Please login to claim rewards"); return false; }
      return withPending(`quest:${questType}`, async () => {
        let result: any;
        try { result = await claimQuest(questType); }
        catch (e) { toast.apiError(e, { onRetry: () => { void get().claim(questType); } }); return false; }

        const markClaimed = (gained?: { xp: number; coins: number }) => {
          changed();
          const h = hud();
          useHUDStore.setState({
            quests: h.quests.map((q: any) => (q.quest_type === questType ? { ...q, claimed: 1 } : q)),
            ...(gained ? { coins: h.coins + gained.coins, xp: h.xp + gained.xp, xpInto: h.xpInto + gained.xp } : {}),
          });
          const shop = get().shop;
          if (shop && gained) set({ shop: { ...shop, coins: shop.coins + gained.coins } });
        };

        if (result?.ok) {
          toast.success(`🎉 Claimed! +${result.xp_gained} XP | +${result.coins_gained} 🪙`, { icon: "✅", duration: 3000 });
          markClaimed({ xp: Number(result.xp_gained) || 0, coins: Number(result.coins_gained) || 0 });
          await get().reconcile();
          return true;
        }
        if (result?.reason === "Already claimed") {            // the server already had it: same end state
          markClaimed();
          await get().reconcile();
          return true;
        }
        toast.error(result?.reason || RESULT_FALLBACK);
        return false;
      });
    },

    afterForgeSave: async () => {
      changed();
      await get().reconcile();
    },

    reset: () => {
      reconciling = null; reconcileAgain = false;
      set({ shop: null, loading: true, previewId: null, forgeGuard: null, pending: {} });
    },
  };
});
