"use client";

import { create } from "zustand";
import { toast } from "@/components/ui/Toast";
import { parseApiError, rawApi } from "@/lib/api";

/**
 * The forge (game/forge.ts): every weapon, outfit, head piece and pet you own, its tier (I-V) and XP bar, your
 * materials, and the pet you ride. The server decides everything; this keeps its last answer.
 */
export interface ForgeItem {
  id: string; category: string; tier: number; xp: number; bonus: number; ready: boolean; worn: boolean; saddled: boolean;
  next: { xp: number; coins: number; common: number; rare: number } | null;
  stage?: "baby" | "young" | "adult"; mount_kind?: "beast" | "bird" | "dragon"; can_saddle?: boolean;
}
export interface ForgeView {
  items: ForgeItem[]; mount: string | null;
  materials: { id: string; name: string; count: number; rare: boolean }[];
  rules: { upgrades: unknown[]; saddle: { tier: number; coins: number; rare: number }; mount_bonus: Record<string, string> };
}

interface State {
  view: ForgeView | null;
  load: (force?: boolean) => Promise<void>;
  upgrade: (item: string) => Promise<boolean>;
  saddle: (pet: string) => Promise<boolean>;
  ride: (pet: string | null) => Promise<boolean>;
  reset: () => void;
}

let inflight: Promise<void> | null = null;

export const useForge = create<State>()((set, get) => {
  const send = async (method: "POST" | "PUT", path: string, body: unknown, retry: () => void) => {
    try {
      const call = method === "PUT" ? rawApi.PUT : rawApi.POST;
      const { data, error, response } = await call(path as never, { body } as never);
      if (response.ok && data) { set({ view: data as ForgeView }); return true; }
      toast.apiError(parseApiError(response.status, error));
      return false;
    } catch (e) { toast.apiError(e, { onRetry: retry }); return false; }
  };
  return {
    view: null,
    load: async (force) => {
      if (inflight) return inflight;
      if (get().view && !force) return;
      inflight = (async () => {
        try {
          const { data, response } = await rawApi.GET("/forge" as never);
          if (response.ok && data) set({ view: data as ForgeView });
        } catch { /* offline */ }
      })().finally(() => { inflight = null; });
      return inflight;
    },
    upgrade: (item) => send("POST", "/forge/upgrade", { item }, () => { void get().upgrade(item); }),
    saddle: (pet) => send("POST", "/forge/saddle", { pet }, () => { void get().saddle(pet); }),
    ride: (pet) => send("PUT", "/forge/mount", { pet }, () => { void get().ride(pet); }),
    reset: () => { inflight = null; set({ view: null }); },
  };
});

/** Each item's tier (1 when it has never been forged). */
export const tierMap = (v: ForgeView | null): Record<string, number> => Object.fromEntries((v?.items ?? []).map((i) => [i.id, i.tier]));
