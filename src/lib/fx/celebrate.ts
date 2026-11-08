// Reward ceremonies (Stage R3), one place to ask for them from anywhere: a shower of coins, an achievement banner,
// the level-up screen. The overlays that draw them are mounted once in the app shell (components/fx).
import { create } from "zustand";
import { sfx } from "@/lib/sound/chip";

export interface Achievement { id: string; name: string; description?: string }

interface Celebrate {
  /** A coin shower: its id changes each time (the overlay replays), and how many coins. */
  rain: { id: number; coins: number } | null;
  /** Achievements waiting for their banner, oldest first. */
  banners: (Achievement & { key: number })[];
  coinRain: (coins: number) => void;
  announce: (list: Achievement[] | undefined | null) => void;
  dismissBanner: (key: number) => void;
}

export const useCelebrate = create<Celebrate>((set) => ({
  rain: null,
  banners: [],
  coinRain: (coins) => { sfx("coin"); set({ rain: { id: Date.now(), coins: Math.max(8, Math.min(60, Math.round(coins / 3))) } }); },
  announce: (list) => {
    if (!list?.length) return;
    sfx("achievement");
    const now = Date.now();
    set((s) => ({ banners: [...s.banners, ...list.map((a, i) => ({ ...a, key: now + i }))] }));
  },
  dismissBanner: (key) => set((s) => ({ banners: s.banners.filter((b) => b.key !== key) })),
}));

export const coinRain = (coins: number) => useCelebrate.getState().coinRain(coins);
export const announceAchievements = (list: Achievement[] | undefined | null) => useCelebrate.getState().announce(list);
