"use client";

import { create } from "zustand";
import { toast } from "@/components/ui/Toast";
import { parseApiError, rawApi } from "@/lib/api";
import type { Appearance } from "@/lib/game/appearance";

/**
 * Your hero (game/build.ts): the seventh fighter you build. The server owns everything here - level, look,
 * build, skill tree and what is unlocked; this store keeps the last answer and sends the player's changes.
 */
export interface HeroBuild { style: string; passive: string; ultimate: string; perks: string[]; weaknesses: string[] }
export interface Named { name: string; text: string }
export interface HeroView {
  level: number; xp: number; level_xp: number; next_level_xp: number | null;
  skill_points: number; skill_spent: number; loadout_budget: number; loadout_cost: number;
  look: Appearance | null; build: HeroBuild; tree: Record<string, number>;
  catalog: {
    styles: { id: string; name: string; bonus: string; weakness: Named; anim: string; owned: boolean; how: string; progress: number | null; for_sale: { coins: number; level: number; can_buy: boolean } | null }[];
    passives: ({ id: string; cost: number; owned: boolean; how: string; progress: number | null } & Named)[];
    ultimates: ({ id: string; cost: number; owned: boolean; how: string; progress: number | null } & Named)[];
    perks: ({ id: string; cost: number; owned: boolean; how: string; for_sale: { coins: number; level: number; can_buy: boolean } | null } & Named)[];
    weaknesses: ({ id: string; points: number } & Named)[];
    tree: { id: string; branch: "o" | "d" | "m"; tier: number; name: string; text: string; ranks: number; unlocks?: string }[];
  };
  looks_unlocked: string[];
}

interface State {
  view: HeroView | null;
  loading: boolean;
  load: (force?: boolean) => Promise<void>;
  saveLook: (look: Appearance | null) => Promise<boolean>;
  saveBuild: (build: HeroBuild) => Promise<boolean>;
  saveTree: (tree: Record<string, number>) => Promise<boolean>;
  buy: (item: string) => Promise<boolean>;
  reset: () => void;
}

let inflight: Promise<void> | null = null;

export const useMyHero = create<State>()((set, get) => {
  const send = async (method: "PUT" | "POST", path: string, body: unknown, onRetry: () => void) => {
    try {
      const call = method === "PUT" ? rawApi.PUT : rawApi.POST;
      const { data, error, response } = await call(path as never, { body } as never);
      if (response.ok && data) { set({ view: data as HeroView }); return true; }
      toast.apiError(parseApiError(response.status, error));
      return false;
    } catch (e) {
      toast.apiError(e, { onRetry });
      return false;
    }
  };
  return {
    view: null,
    loading: false,
    load: async (force) => {
      if (inflight) return inflight;
      if (get().view && !force) return;
      set({ loading: true });
      inflight = (async () => {
        try {
          const { data, response } = await rawApi.GET("/hero" as never);
          if (response.ok && data) set({ view: data as HeroView });
        } catch { /* offline: keep what we had */ }
        finally { set({ loading: false }); }
      })().finally(() => { inflight = null; });
      return inflight;
    },
    saveLook: (look) => send("PUT", "/hero/look", { look }, () => { void get().saveLook(look); }),
    saveBuild: (build) => send("PUT", "/hero/build", { build }, () => { void get().saveBuild(build); }),
    saveTree: (tree) => send("PUT", "/hero/tree", { tree }, () => { void get().saveTree(tree); }),
    buy: (item) => send("POST", "/hero/buy", { item }, () => { void get().buy(item); }),
    reset: () => { inflight = null; set({ view: null, loading: false }); },
  };
});
