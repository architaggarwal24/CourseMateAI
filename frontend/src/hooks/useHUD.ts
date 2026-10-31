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
  /** Counts local changes (a purchase, a claim ...). A refresh that started before the latest one is stale and is dropped. */
  _epoch: number;
  /** The newest refresh; an older one answering late must not overwrite it. */
  _seq: number;
  /** Local state was just changed (optimistically): any refresh already in flight is out of date. */
  markChanged: () => void;
  refresh: () => Promise<void>;
  refreshIfStale: (minAgeMs?: number) => Promise<void>;
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
  _epoch: 0,
  _seq: 0,

  markChanged: () => set((s) => ({ _epoch: s._epoch + 1 })),

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
    const seq = get()._seq + 1;
    const epoch = get()._epoch;
    set({ loading: true, _seq: seq });
    try {
      const data = await fetchHUD();
      // Answered after a newer refresh, or after the screen changed something locally: this data is old. Drop it.
      if (get()._seq !== seq || get()._epoch !== epoch) {
        if (get()._seq === seq) set({ loading: false });
        return;
      }
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
      if (get()._seq === seq) set({ loading: false });
    }
  },
}));