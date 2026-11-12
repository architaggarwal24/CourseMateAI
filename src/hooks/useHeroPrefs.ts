"use client";

import { create } from "zustand";

/**
 * The Hero world's own switches (the two worlds, Stage 4), kept in this browser: the pixel cursor, menu sounds,
 * lobby music (off at first), CRT scanlines (off at first), and the healthy-play nudge (Stage 5).
 */
export interface HeroPrefs { cursor: boolean; menuSounds: boolean; lobbyMusic: boolean; scanlines: boolean; nudge: boolean }
export const HERO_PREFS_DEFAULT: HeroPrefs = { cursor: true, menuSounds: true, lobbyMusic: false, scanlines: false, nudge: true };
const KEY = "cmai_hero_prefs";

interface PrefsState extends HeroPrefs {
  loaded: boolean;
  load: () => void;
  set: (p: Partial<HeroPrefs>) => void;
}

export const useHeroPrefs = create<PrefsState>()((set, get) => ({
  ...HERO_PREFS_DEFAULT,
  loaded: false,
  load: () => {
    if (get().loaded) return;
    let saved: Partial<HeroPrefs> = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { /* storage blocked or broken: the defaults */ }
    const clean = Object.fromEntries(Object.entries(saved).filter(([k, v]) => k in HERO_PREFS_DEFAULT && typeof v === "boolean"));
    set({ ...HERO_PREFS_DEFAULT, ...clean, loaded: true });
  },
  set: (p) => {
    set(p);
    const { cursor, menuSounds, lobbyMusic, scanlines, nudge } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ cursor, menuSounds, lobbyMusic, scanlines, nudge })); } catch { /* storage blocked: this visit only */ }
  },
}));
