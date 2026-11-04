"use client";

import { create } from "zustand";
import { fetchEntitlements, fetchReviewStats, type Entitlements, type Feature, type ReviewStats } from "@/lib/study/review";

/**
 * The review queue's counts (the nav badge, the Review tab) and the plan's entitlements, for the whole app.
 * Loaded once a user is signed in, again when the window gets focus, and updated from every grade's answer.
 */
interface ReviewState {
  stats: ReviewStats | null;
  entitlements: Entitlements | null;
  load: () => Promise<void>;
  setStats: (stats: ReviewStats | null | undefined) => void;
  reset: () => void;
}

let inflight: Promise<void> | null = null;

export const useReview = create<ReviewState>()((set) => ({
  stats: null,
  entitlements: null,
  load: () => {
    if (inflight) return inflight;
    inflight = (async () => {
      const [stats, entitlements] = await Promise.all([fetchReviewStats(), fetchEntitlements()]);
      set((s) => ({ stats: stats ?? s.stats, entitlements: entitlements ?? s.entitlements }));
    })().finally(() => { inflight = null; });
    return inflight;
  },
  setStats: (stats) => { if (stats) set({ stats }); },
  reset: () => { inflight = null; set({ stats: null, entitlements: null }); },
}));

/** Whether the plan has `feature` (true until the entitlements are known: the server is the real gate). */
export function featureEnabled(entitlements: Entitlements | null, feature: Feature): boolean {
  return entitlements?.features?.[feature]?.enabled ?? true;
}

/** The due count for a badge: 0 when nothing is due or the queue is locked. */
export function dueBadge(stats: ReviewStats | null): number {
  return stats && !stats.locked ? stats.due : 0;
}
