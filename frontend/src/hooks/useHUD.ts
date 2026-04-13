import { create } from "zustand";
import { fetchHUD } from "@/lib/api";

interface HUDState {
  userId: string;
  level: number;
  xp: number;
  coins: number;
  xpInto: number;
  xpToNext: number;
  streakDays: number;
  streakFreezes: number;
  quests: any[];
  shop: any;
  buffs: Record<string, any>;
  /** Inventory quantities for consumable items (always populated, even below level 5) */
  consumableInventory: Record<string, number>;
  guestMode: boolean;
  loading: boolean;
  _lastRefresh: number;
  refresh: () => Promise<void>;
  refreshIfStale: (minAgeMs?: number) => Promise<void>;
  applyReward: (xpGained: number, coinsGained: number) => void;
  init: () => Promise<void>;
  setUserId: (id: string) => void;
  setUserIdAsync: (id: string) => Promise<void>;
}

export const useHUDStore = create<HUDState>((set, get) => ({
  userId: "guest",
  level: 1,
  xp: 0,
  coins: 0,
  xpInto: 0,
  xpToNext: 100,
  streakDays: 0,
  streakFreezes: 0,
  quests: [],
  shop: { shop_unlocked: false, items: [] },
  buffs: {},
  consumableInventory: {},
  guestMode: true,
  loading: false,
  _lastRefresh: 0,

  // Optimistic update: apply reward XP/coins immediately without a network round-trip.
  // Also recomputes level thresholds so the XP bar is accurate even on level-up.
  applyReward: (xpGained: number, coinsGained: number) => {
    set((s) => {
      const newXp = s.xp + xpGained;
      const newCoins = s.coins + coinsGained;
      // Recompute level and progress so the XP bar stays accurate after level-up
      let lvl = s.level;
      let into = s.xpInto + xpGained;
      let toNext = s.xpToNext;
      while (into >= toNext) {
        into -= toNext;
        lvl += 1;
        // Approximate next-level XP using the same formula as the backend
        toNext = Math.max(100, Math.round((Math.round(75 * Math.pow(lvl, 1.5) / 50) * 50)));
      }
      return { xp: newXp, coins: newCoins, level: lvl, xpInto: into, xpToNext: toNext };
    });
  },

  // Only refresh if the HUD data is older than minAgeMs (default 30s)
  refreshIfStale: async (minAgeMs = 30_000) => {
    const { _lastRefresh, refresh } = get();
    if (Date.now() - _lastRefresh > minAgeMs) {
      await refresh();
    }
  },

  setUserId: (id: string) => {
    set({ userId: id });
    void get().refresh(); // fire-and-forget for non-critical sync callers
  },

  setUserIdAsync: async (id: string) => {
    set({ userId: id });
    await get().refresh(); // awaitable version for callers that need fresh HUD state
  },

  init: async () => { await get().refresh(); },

  refresh: async () => {
    set({ loading: true });
    try {
      const data = await fetchHUD();
      if (data) {
        const progress = data.progress || {};
        set({
          level: progress.current_level || 1,
          xp: progress.total_xp || 0,
          coins: progress.coins || 0,
          xpInto: progress.xp_into_level || 0,
          xpToNext: progress.xp_to_next || 100,
          streakDays: progress.streak_days || 0,
          streakFreezes: progress.streak_freezes || 0,
          quests: data.quests || [],
          shop: data.shop || { shop_unlocked: false, items: [] },
          buffs: data.buffs || {},
          consumableInventory: data.consumable_inventory || {},
          guestMode: data.guest_mode !== false,
          loading: false,
          _lastRefresh: Date.now(),
        });
      } else {
        set({
          level: 1, xp: 0, coins: 0, xpInto: 0, xpToNext: 100,
          streakDays: 0, streakFreezes: 0,
          quests: [], shop: { shop_unlocked: false, items: [] },
          buffs: {}, consumableInventory: {}, guestMode: true, loading: false,
        });
      }
    } catch (error) {
      // On transient network error: just clear loading flag, keep existing state
      // so the UI doesn't wipe valid HUD data on a momentary blip.
      console.error("HUD refresh error:", error);
      set({ loading: false });
    }
  },
}));