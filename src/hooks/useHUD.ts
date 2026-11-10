import { create } from "zustand";
import { fetchHUD } from "@/lib/api";
import type { PlanNotice } from "@/lib/planNotice";

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
  /** "You've been upgraded", waiting to be shown (components/fx/UpgradeCeremony.tsx). */
  planNotice: PlanNotice | null;
  loading: boolean;
  _lastRefresh: number;
  /** Counts local changes (a purchase, a claim ...). A refresh that started before the latest one is stale and is dropped. */
  _epoch: number;
  /** The newest refresh; an older one answering late must not overwrite it. */
  _seq: number;
  /** Local state was just changed (optimistically): any refresh already in flight is out of date. */
  markChanged: () => void;
  /** Always asks the server (after a purchase, a claim, a reward: the screen needs the server's new numbers). */
  refresh: () => Promise<void>;
  refreshIfStale: (minAgeMs?: number) => Promise<void>;
  /**
   * Start-up: make sure the HUD has been loaded for this session. Shares a request already in flight and skips one
   * answered in the last few seconds, so AppShell mounting and the sign-in check together ask GET /hud once.
   */
  load: () => Promise<void>;
  init: () => Promise<void>;
  setUserId: (id: string) => void;
  setUserIdAsync: (id: string) => Promise<void>;
}

/** What a signed-out visitor sees: the server's guest HUD is always exactly this, so it is never fetched. */
const GUEST = {
  level: 1, xp: 0, coins: 0, xpInto: 0, xpToNext: 100, streakDays: 0, streakFreezes: 0,
  quests: [] as any[], shop: { shop_unlocked: false, items: [] }, buffs: {}, consumableInventory: {}, guestMode: true,
  planNotice: null as PlanNotice | null,
};

/** A load() within this long of the last answer reuses it. */
const FRESH_MS = 10_000;

// The start-up request in flight (load() shares it). Outside the store: a promise is not state to render.
let inflight: { p: Promise<void>; seq: number; epoch: number } | null = null;
// False until the sign-in check has answered once: until then a request already in flight was sent with the same
// cookie the answer is about, so it can be reused.
let identityKnown = false;

/** Tests start from a fresh store. */
export function resetHudForTests(): void {
  inflight = null;
  identityKnown = false;
  useHUDStore.setState({ ...GUEST, userId: "guest", loading: false, _lastRefresh: 0, _epoch: 0, _seq: 0 });
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
  planNotice: null,
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

  load: () => {
    const s = get();
    if (inflight && inflight.seq === s._seq && inflight.epoch === s._epoch) return inflight.p;
    if (s._lastRefresh && Date.now() - s._lastRefresh < FRESH_MS) return Promise.resolve();
    return get().refresh();
  },

  setUserId: (id: string) => { void get().setUserIdAsync(id); },

  /**
   * Who is signed in changed (or was just learned). A visitor gets the guest HUD at once, with no request; the first
   * answer for an account reuses a start-up request already in flight; a different account always asks again.
   */
  setUserIdAsync: async (id: string) => {
    const changed = identityKnown && get().userId !== id;
    identityKnown = true;
    if (id === "guest") {
      inflight = null;
      // _seq moves on, so an answer still on its way for the old account is dropped.
      set((s) => ({ ...GUEST, userId: id, loading: false, _seq: s._seq + 1, _lastRefresh: 0 }));
      return;
    }
    set({ userId: id, guestMode: false });
    await (changed ? get().refresh() : get().load());
  },

  init: async () => { await get().refresh(); },

  refresh: () => {
    const seq = get()._seq + 1;
    const epoch = get()._epoch;
    const p = fetchInto(seq, epoch);
    inflight = { p, seq, epoch };
    void p.finally(() => { if (inflight?.seq === seq) inflight = null; });
    return p;
  },
}));

/** One GET /hud into the store. An answer overtaken by a newer request, or by a local change, is dropped. */
async function fetchInto(seq: number, epoch: number): Promise<void> {
  const set = useHUDStore.setState;
  const get = useHUDStore.getState;
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
        planNotice: (data.plan_notice as PlanNotice | null | undefined) ?? null,
        loading: false,
        _lastRefresh: Date.now(),
      });
    } else {
      set({ ...GUEST, loading: false });
    }
  } catch (error) {
    // On transient network error: just clear loading flag, keep existing state
    // so the UI doesn't wipe valid HUD data on a momentary blip.
    console.error("HUD refresh error:", error);
    if (get()._seq === seq) set({ loading: false });
  }
}
