"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_HERO, HEROES } from "@/lib/pixel/heroes";

/** The fighter the player brings into the arena (kept in this browser). */
export const useArenaHero = create<{ heroId: string; setHero: (id: string) => void }>()(
  persist(
    (set) => ({
      heroId: DEFAULT_HERO,
      setHero: (id) => set({ heroId: HEROES.some((h) => h.id === id) ? id : DEFAULT_HERO }),
    }),
    { name: "cmai_arena_hero" },
  ),
);
