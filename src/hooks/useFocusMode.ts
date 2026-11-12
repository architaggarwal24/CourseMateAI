"use client";

import { create } from "zustand";
import { ambient, type Ambient } from "@/lib/sound/ambient";
import { BREAK_MS, FOCUS_MS } from "@/lib/game/focus";

/**
 * Study's focus mode (the two worlds, Stage 6): a distraction-free view with a Pomodoro clock and ambient sound.
 * The clock is a deadline (`endsAt`), or the time it had left while paused.
 */
export type FocusPhase = "focus" | "break";
interface FocusState {
  on: boolean;
  phase: FocusPhase;
  endsAt: number | null;
  pausedLeft: number | null;
  sessions: number;
  sound: Ambient;
  start: () => void;
  exit: () => void;
  togglePause: () => void;
  /** The phase ran out: focus -> break (a session done), break -> focus. */
  advance: () => FocusPhase;
  setSound: (s: Ambient) => void;
}

export const useFocusMode = create<FocusState>()((set, get) => ({
  on: false, phase: "focus", endsAt: null, pausedLeft: null, sessions: 0, sound: "off",
  start: () => set({ on: true, phase: "focus", endsAt: Date.now() + FOCUS_MS, pausedLeft: null }),
  exit: () => { ambient.stop(); set({ on: false, endsAt: null, pausedLeft: null, sound: "off" }); },
  togglePause: () => {
    const { endsAt, pausedLeft } = get();
    if (pausedLeft !== null) set({ endsAt: Date.now() + pausedLeft, pausedLeft: null });
    else if (endsAt !== null) set({ pausedLeft: Math.max(0, endsAt - Date.now()), endsAt: null });
  },
  advance: () => {
    const next: FocusPhase = get().phase === "focus" ? "break" : "focus";
    set((s) => ({ phase: next, endsAt: Date.now() + (next === "focus" ? FOCUS_MS : BREAK_MS), pausedLeft: null, sessions: s.sessions + (next === "break" ? 1 : 0) }));
    return next;
  },
  setSound: (s) => { ambient.play(s); set({ sound: s }); },
}));
