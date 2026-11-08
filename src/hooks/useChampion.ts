"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toast } from "@/components/ui/Toast";
import { parseApiError, rawApi } from "@/lib/api";
import { DEFAULT_HERO, HEROES } from "@/lib/pixel/heroes";

/**
 * The player's pixel champion: THE avatar on every screen (header, menu, profile, shop, arena).
 *
 * The account owns it (GET / PUT /avatar/champion, stored by the server since migration 0008); this browser keeps
 * a copy only so the right champion shows before the server answers. Skins are the equipped shop items
 * (useHeroStore), shared by every champion.
 *
 * Phase 2 kept the arena pick in this browser only (LEGACY_HERO_KEY). The first load after the upgrade moves it to
 * the account - once, and only if the account has no choice of its own yet.
 */
export const CHAMPION_CACHE_KEY = "cmai_champion";
export const LEGACY_HERO_KEY = "cmai_arena_hero";

const isChampion = (id: unknown): id is string => typeof id === "string" && HEROES.some((h) => h.id === id);

/** A champion's progress (XP from battles fought with it), its kit and the mastery skins its levels unlock. */
export interface ChampionProgress {
  xp: number; level: number; level_xp: number; next_level_xp: number | null; battles: number; wins: number;
  mastery: { id: string; slot: string; level: number }[];
  kit: { passive: { name: string; text: string }; ultimate: { name: string; text: string } };
  /** The champion's own mastery weapon (the level 10 skin): its perk, its finisher, and whether it is owned / worn. */
  signature?: { weapon: string; perk: { name: string; text: string }; finisher: string; owned: boolean; worn: boolean };
  /** Stage C1 locks: how the champion joins, how far along that is, and whether its ceremony was seen. */
  unlock?: ChampionUnlock;
}

export interface ChampionUnlock {
  unlocked: boolean; source: string | null; celebrated: boolean; how: string; have: number; need: number;
  reward: { xp: number; coins: number };
}

/** Whether a champion may be picked (unknown, e.g. for a visitor or an older server: yes). */
export const isUnlocked = (progress: Record<string, ChampionProgress>, id: string) => progress[id]?.unlock?.unlocked ?? true;

/** The first champion who joined and has not had a ceremony yet. */
export const ceremonyDue = (progress: Record<string, ChampionProgress>): string | null =>
  HEROES.map((h) => h.id).find((id) => progress[id]?.unlock?.unlocked && progress[id]?.unlock?.celebrated === false) ?? null;

interface ChampionState {
  championId: string;
  /** The player chose it (false: a default, or a champion mapped from the retired Hero Forge). */
  chosen: boolean;
  /** The server's answer has arrived (this session). */
  loaded: boolean;
  /** null until the app knows whether someone is logged in (a pick made meanwhile is saved once it does). */
  signedIn: boolean | null;
  /** Per champion, from the server (empty until it answers, and for a visitor). */
  progress: Record<string, ChampionProgress>;
  load: (opts: { signedIn: boolean; force?: boolean }) => Promise<void>;
  choose: (id: string) => Promise<boolean>;
  /** The unlock ceremony was seen: claims its reward (once). Resolves with what was paid, or null. */
  celebrate: (id: string) => Promise<{ xp: number; coins: number } | null>;
  reset: () => void;
}

type Answer = { champion_id?: string; chosen?: boolean; progress?: Record<string, ChampionProgress> };

let inflight: Promise<void> | null = null;
let changeSeq = 0;
/** A pick made before the app knew who is logged in: saved to the account by the next signed-in load. */
let pendingChoice: string | null = null;

function legacyPick(): string | null {
  try {
    const raw = localStorage.getItem(LEGACY_HERO_KEY);
    const id = raw ? JSON.parse(raw)?.state?.heroId : null;
    return isChampion(id) ? id : null;
  } catch { return null; }
}
function dropLegacy() { try { localStorage.removeItem(LEGACY_HERO_KEY); } catch { /* storage blocked */ } }

export const useChampion = create<ChampionState>()(
  persist(
    (set, get) => {
      const apply = (a: Answer | undefined) => {
        set((s) => ({
          championId: isChampion(a?.champion_id) ? a!.champion_id! : DEFAULT_HERO, chosen: !!a?.chosen && isChampion(a?.champion_id),
          loaded: true, progress: a?.progress ?? s.progress,
        }));
      };

      return {
        championId: DEFAULT_HERO,
        chosen: false,
        loaded: false,
        signedIn: null,
        progress: {},

        load: async ({ signedIn, force }) => {
          set({ signedIn });
          if (!signedIn) { pendingChoice = null; set({ loaded: true }); return; }
          if (pendingChoice) {
            const id = pendingChoice;
            pendingChoice = null;
            dropLegacy();
            await get().choose(id);
            return;
          }
          if (inflight) return inflight;
          if (get().loaded && !force) return;
          const seq = changeSeq;
          inflight = (async () => {
            try {
              const { data, response } = await rawApi.GET("/avatar/champion");
              if (!response.ok || !data) return;
              if (seq !== changeSeq) return;              // the player picked one while we waited: theirs wins
              const answer = data as Answer;
              const local = legacyPick();
              if (local && !answer.chosen && local !== answer.champion_id) {
                const put = await rawApi.PUT("/avatar/champion", { body: { champion_id: local } });
                apply(put.response.ok ? (put.data as Answer) : answer);
              } else apply(answer);
              dropLegacy();
            } catch { /* offline: the cached champion stays on screen */ }
          })().finally(() => { inflight = null; });
          return inflight;
        },

        choose: async (id) => {
          if (!isChampion(id)) return false;
          const lock = get().progress[id]?.unlock;
          if (lock && !lock.unlocked) {
            const name = HEROES.find((h) => h.id === id)!.name;
            toast.info(`${name} hasn't joined you yet. ${lock.how} (${lock.have} of ${lock.need}).`);
            return false;
          }
          const before = { championId: get().championId, chosen: get().chosen };
          changeSeq++;
          set({ championId: id, chosen: true });
          if (get().signedIn === null) { pendingChoice = id; return true; }
          if (!get().signedIn) return true;
          try {
            const { data, error, response } = await rawApi.PUT("/avatar/champion", { body: { champion_id: id } });
            if (response.ok && data) { apply(data as Answer); return true; }
            set(before);
            toast.apiError(parseApiError(response.status, error));
            return false;
          } catch (e) {
            set(before);
            toast.apiError(e, { onRetry: () => { void get().choose(id); } });
            return false;
          }
        },

        celebrate: async (id) => {
          // seen at once (the ceremony doesn't come back), whatever the network does
          set((s) => s.progress[id]?.unlock ? { progress: { ...s.progress, [id]: { ...s.progress[id], unlock: { ...s.progress[id].unlock!, celebrated: true } } } } : s);
          if (!get().signedIn) return null;
          try {
            const { data, response } = await rawApi.POST("/avatar/champion/celebrate" as never, { body: { champion_id: id } } as never);
            if (!response.ok || !data) return null;
            const d = data as { reward?: { xp: number; coins: number }; state?: Answer };
            if (d.state) apply(d.state);
            return d.reward ?? null;
          } catch { return null; }
        },

        reset: () => { inflight = null; pendingChoice = null; changeSeq++; set({ championId: DEFAULT_HERO, chosen: false, loaded: false, signedIn: null, progress: {} }); },
      };
    },
    {
      name: CHAMPION_CACHE_KEY,
      partialize: (s) => ({ championId: s.championId, chosen: s.chosen }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ChampionState> | undefined;
        return { ...current, championId: isChampion(p?.championId) ? p!.championId! : current.championId, chosen: !!p?.chosen };
      },
    },
  ),
);
