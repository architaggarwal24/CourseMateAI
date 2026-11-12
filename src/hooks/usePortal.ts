"use client";

import { create } from "zustand";
import { sfx } from "@/lib/sound/chip";
import type { World } from "@/lib/worlds";

/**
 * Crossing between the two worlds (Stage 2): the portal transition's state. `cover` - the screen breaks up into
 * blocks in the world you're leaving, then the page changes; `reveal` - the blocks fall away in the new world.
 * PortalTransition draws it and moves the phases along; anything can start a crossing with `cross`.
 */
export type PortalPhase = "idle" | "cover" | "reveal";
interface PortalState {
  phase: PortalPhase;
  to: World | null;
  href: string | null;
  /** Bumped by every crossing (the overlay redraws its blocks). */
  seq: number;
  cross: (to: World, href: string) => void;
  revealed: () => void;
  done: () => void;
}

export const usePortal = create<PortalState>()((set, get) => ({
  phase: "idle", to: null, href: null, seq: 0,
  cross: (to, href) => {
    if (get().phase !== "idle") return;
    sfx(to === "hero" ? "portal" : "portalBack");
    set((s) => ({ phase: "cover", to, href, seq: s.seq + 1 }));
  },
  revealed: () => { if (get().phase === "cover") set({ phase: "reveal" }); },
  done: () => set({ phase: "idle", href: null }),
}));
