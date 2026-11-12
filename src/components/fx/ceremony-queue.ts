// One celebration at a time: the level-up screen says when it is open, and the upgrade window waits for it.
import { create } from "zustand";

export const useCeremonyQueue = create<{ levelUpOpen: boolean; setLevelUpOpen: (open: boolean) => void }>((set) => ({
  levelUpOpen: false,
  setLevelUpOpen: (levelUpOpen) => set({ levelUpOpen }),
}));
