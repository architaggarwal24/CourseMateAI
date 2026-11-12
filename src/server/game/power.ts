// Power level (Stage 6): how strong a player is in the arena, from two things they did - their best score cards (the
// five best won fights) and the creatures they have hunted (each beaten species adds by its Bestiary tier). Boss
// Rush and Survival match their bosses to it: every boss has a power of its own (its tier, its difficulty, its HP),
// and the fight picks the creature, difficulty and HP that come closest to the power it wants.
import { sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import * as tome from "./tome";

export const TIER_POWER: Record<number, number> = { 1: 20, 2: 35, 3: 55, 4: 80 };
export const DIFF_POWER: Record<string, number> = { easy: 0.8, medium: 1, hard: 1.3, nightmare: 1.7 };
export const DIFFICULTIES = ["easy", "medium", "hard", "nightmare"] as const;
const BASE = 10, SCORE_PER_POWER = 40, BEST_FIGHTS = 5;
const HP_MIN = 0.75, HP_MAX = 2.5;

/** A boss's power: its creature's tier, its difficulty, and how much HP it has (x its usual). */
export const bossPower = (species: string, difficulty: string, hpScale = 1) =>
  Math.round((TIER_POWER[tome.tierOf(species)] ?? 20) * (DIFF_POWER[difficulty] ?? 1) * hpScale);

/** What a beaten species adds to your power. */
export const huntPower = (species: string) => Math.round((TIER_POWER[tome.tierOf(species)] ?? 20) / 4);

export interface PowerLevel {
  power: number;
  /** The two parts: the five best score cards, and the creatures hunted. */
  from_score: number;
  from_hunts: number;
  best_scores: number[];
  /** The species beaten, strongest first (Boss Rush's three come from here). */
  hunted: string[];
}

export function powerFrom(bestScores: number[], hunted: string[]): Omit<PowerLevel, "best_scores" | "hunted"> {
  const top = [...bestScores].sort((a, b) => b - a).slice(0, BEST_FIGHTS);
  const avg = top.length ? top.reduce((x, y) => x + y, 0) / top.length : 0;
  const fromScore = Math.round(avg / SCORE_PER_POWER);
  const fromHunts = hunted.reduce((sum, s) => sum + huntPower(s), 0);
  return { power: BASE + fromScore + fromHunts, from_score: fromScore, from_hunts: fromHunts };
}

/** The species beaten, strongest first: by tier, then by wins. */
export function huntedOrder(recs: Map<string, tome.RecordRow>): string[] {
  return [...recs.values()].filter((r) => r.wins > 0 && r.species !== "ammit")
    .sort((a, b) => tome.tierOf(b.species) - tome.tierOf(a.species) || b.wins - a.wins || a.species.localeCompare(b.species))
    .map((r) => r.species);
}

export async function powerLevel(ctx: RequestContext, userId: number): Promise<PowerLevel> {
  const rows = await ctx.db.all<{ t: number | null }>(sql`
    SELECT json_extract(result_json, '$.score.total') AS t FROM arena_battles
    WHERE user_id = ${userId} AND status = 'won' AND result_json IS NOT NULL ORDER BY t DESC LIMIT ${BEST_FIGHTS}`);
  const best = rows.map((r) => Number(r.t ?? 0)).filter((t) => t > 0);
  const hunted = huntedOrder(await tome.records(ctx, userId));
  return { ...powerFrom(best, hunted), best_scores: best, hunted };
}

export interface Match { species: string; difficulty: string; hp_scale: number; power: number }

/**
 * The boss closest to a power: from these creatures and every difficulty, the pair nearest the target (a step
 * easier wins a tie), then its HP tuned (within 0.75x-2.5x) to land on it.
 */
export function matchBoss(target: number, species: string[], difficulties: readonly string[] = DIFFICULTIES): Match {
  let best: { species: string; difficulty: string; gap: number } | null = null;
  for (const sp of species) {
    for (const d of difficulties) {
      const gap = Math.abs(bossPower(sp, d) - target);
      if (!best || gap < best.gap) best = { species: sp, difficulty: d, gap };
    }
  }
  if (!best) throw new Error("matchBoss needs at least one creature");
  const raw = target / Math.max(1, bossPower(best.species, best.difficulty));
  const hp = Math.round(Math.min(HP_MAX, Math.max(HP_MIN, raw)) * 20) / 20;
  return { species: best.species, difficulty: best.difficulty, hp_scale: hp, power: bossPower(best.species, best.difficulty, hp) };
}
