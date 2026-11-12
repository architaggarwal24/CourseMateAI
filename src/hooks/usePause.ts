"use client";

import { create } from "zustand";

/** The Hero world's pause menu (the two worlds, Stage 3): open or not, and which page of it is showing. */
export type PauseView = "menu" | "options" | "controls";
interface PauseState {
  open: boolean;
  view: PauseView;
  show: (view?: PauseView) => void;
  close: () => void;
  setView: (view: PauseView) => void;
}

export const usePause = create<PauseState>()((set) => ({
  open: false,
  view: "menu",
  show: (view = "menu") => set({ open: true, view }),
  close: () => set({ open: false, view: "menu" }),
  setView: (view) => set({ view }),
}));
