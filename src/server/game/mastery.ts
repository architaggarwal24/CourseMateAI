// Champion mastery (0-100%): 70% from champion XP (levels 1-10) + 30% from six challenges worth 5% each, mixing
// fights and study. 100% is what earns a champion's style, emotes, ultimate and look for your hero (later phases).
//
// Fight challenges are counted from what the fight recorded (kits.ts KitState.stats) when it ends; study challenges
// count for the champion who is equipped when the studying happens.
import { and, eq } from "drizzle-orm";
import type { RequestContext } from "../context";
import { championChallenges } from "../db/schema";
import { DEFAULT_CHAMPION, isChampion, type Champion } from "./content";
import type { FightStat } from "./kits";
import { LEVEL_XP } from "./kits";
import { getAvatar, getProgress, nowIso } from "./store";

export const XP_SHARE = 70;
export const CHALLENGE_SHARE = 5;
export const MAX_XP = LEVEL_XP[LEVEL_XP.length - 1];
/** Mastery % at which a champion's passive can be learned by your hero, and the whole kit / style / look (100). */
export const PASSIVE_AT = 50;

/** What a finished fight tells the challenges. */
export interface FightSummary {
  won: boolean; correct: number; difficulty: string; flawless: boolean; seconds: number; heartsLeft: number;
  stats: Partial<Record<FightStat, number>>; tiersFinished: number;
}
export type StudyEvent = "review_card" | "quiz80";

interface Challenge {
  id: string; text: string; target: number;
  /** How much one fight adds (sum), or the new value (max / streak). */
  fight?: (f: FightSummary) => number;
  study?: StudyEvent;
  /** "sum" adds up (default); "max" keeps the best; "streak" adds and drops back to 0 when the fight adds 0. */
  mode?: "sum" | "max" | "streak";
  /** The study streak (days in a row), read from the player's progress. */
  streak?: boolean;
}

const hard = (d: string) => d === "hard" || d === "nightmare";
const stat = (k: FightStat) => (f: FightSummary) => f.stats[k] ?? 0;
const WIN10: Challenge = { id: "win10", text: "Win 10 fights", target: 10, fight: (f) => (f.won ? 1 : 0) };
const RIGHT100: Challenge = { id: "right100", text: "Answer 100 questions right in fights", target: 100, fight: (f) => f.correct };
const NIGHTMARE: Challenge = { id: "nightmare", text: "Win on nightmare", target: 1, fight: (f) => (f.won && f.difficulty === "nightmare" ? 1 : 0) };
const STREAK7: Challenge = { id: "streak7", text: "Reach a 7-day study streak", target: 7, streak: true, mode: "max" };
const QUIZ80: Challenge = { id: "quiz80", text: "Finish 5 quizzes at 80% or better", target: 5, study: "quiz80" };

export const CHALLENGES: Record<Champion, Challenge[]> = {
  kaien: [WIN10, { id: "riposte15", text: "Land 15 Ripostes", target: 15, fight: stat("riposte") },
    { id: "ultko5", text: "KO a boss with Ninth Page Cut 5 times", target: 5, fight: stat("ult_ko") }, RIGHT100,
    { id: "flawless", text: "Win on hard without losing a heart", target: 1, fight: (f) => (f.won && hard(f.difficulty) && f.flawless ? 1 : 0) },
    { id: "tier", text: "Finish a Bestiary tier", target: 1, fight: (f) => f.tiersFinished }],
  asha: [WIN10, { id: "jab50", text: "Land 50 right Jabs", target: 50, fight: stat("right_jab") },
    { id: "wall10", text: "Take 10 blows under Dawn Wall", target: 10, fight: stat("wall_blow") }, RIGHT100, NIGHTMARE, STREAK7],
  brak: [WIN10, { id: "combo8", text: "Reach an 8-combo 5 times", target: 5, fight: stat("combo8") },
    { id: "rush6", text: "Land Iron Rush at combo 6 or more 5 times", target: 5, fight: stat("rush6") }, RIGHT100,
    { id: "row3", text: "Win 3 fights in a row", target: 3, mode: "streak", fight: (f) => (f.won ? 1 : 0) }, QUIZ80],
  mira: [WIN10, { id: "spell30", text: "Cast 30 spells", target: 30, fight: stat("spell") },
    { id: "ultko5", text: "KO a boss with Arcane Library 5 times", target: 5, fight: stat("ult_ko") }, RIGHT100,
    { id: "noheavy", text: "Win a fight without a Heavy", target: 1, fight: (f) => (f.won && !(f.stats.heavy ?? 0) ? 1 : 0) }, STREAK7],
  vex: [WIN10, { id: "slip25", text: "Slip past 25 blows", target: 25, fight: stat("slip") },
    { id: "vanish10", text: "Vanish 10 times", target: 10, fight: stat("ultimate") }, RIGHT100,
    { id: "fast", text: "Win on hard in under 3 minutes", target: 1, fight: (f) => (f.won && hard(f.difficulty) && f.seconds < 180 ? 1 : 0) }, QUIZ80],
  thorne: [WIN10, { id: "block30", text: "Block 30 blows with a right answer", target: 30, fight: stat("right_block") },
    { id: "lasthp3", text: "Win 3 fights on your last heart", target: 3, fight: (f) => (f.won && f.heartsLeft === 1 ? 1 : 0) }, RIGHT100, NIGHTMARE,
    { id: "review300", text: "Review 300 cards", target: 300, study: "review_card" }],
};

type Row = typeof championChallenges.$inferSelect;
export interface ChallengeView { id: string; text: string; progress: number; target: number; done: boolean }
export interface MasteryView { pct: number; challenges: ChallengeView[]; passive_learnable: boolean; complete: boolean }

/** Mastery for one champion from its XP and its challenge rows. */
export function masteryOf(champion: Champion, xp: number, rows: Row[]): MasteryView {
  const challenges = CHALLENGES[champion].map((c) => {
    const r = rows.find((x) => x.championId === champion && x.challengeId === c.id);
    const done = !!r?.doneAt;
    return { id: c.id, text: c.text, target: c.target, progress: done ? c.target : Math.min(c.target, r?.progress ?? 0), done };
  });
  const pct = Math.min(100, Math.floor(XP_SHARE * Math.min(1, xp / MAX_XP) + CHALLENGE_SHARE * challenges.filter((c) => c.done).length));
  return { pct, challenges, passive_learnable: pct >= PASSIVE_AT, complete: pct >= 100 };
}

export const challengeRows = (ctx: RequestContext, userId: number) =>
  ctx.db.select().from(championChallenges).where(eq(championChallenges.userId, userId)).all();

/** Move one champion's challenges by `step(c, current)` (null: untouched). Returns the challenges finished just now. */
async function advance(ctx: RequestContext, userId: number, champion: Champion, step: (c: Challenge, current: number) => number | null): Promise<string[]> {
  const rows = await ctx.db.select().from(championChallenges)
    .where(and(eq(championChallenges.userId, userId), eq(championChallenges.championId, champion))).all();
  const finished: string[] = [];
  const t = nowIso();
  for (const c of CHALLENGES[champion]) {
    const r = rows.find((x) => x.challengeId === c.id);
    if (r?.doneAt) continue;
    const before = r?.progress ?? 0;
    const next = step(c, before);
    if (next === null || next === before) continue;
    const progress = Math.max(0, Math.min(c.target, next));
    const doneAt = progress >= c.target ? t : null;
    if (doneAt) finished.push(c.text);
    await ctx.db.insert(championChallenges).values({ userId, championId: champion, challengeId: c.id, progress, doneAt, updatedAt: t })
      .onConflictDoUpdate({ target: [championChallenges.userId, championChallenges.championId, championChallenges.challengeId], set: { progress, doneAt, updatedAt: t } });
  }
  return finished;
}

/** A fight ended: its champion's fight challenges move on. */
export function recordFight(ctx: RequestContext, userId: number, champion: string, f: FightSummary): Promise<string[]> {
  if (!isChampion(champion)) return Promise.resolve([]);
  return advance(ctx, userId, champion, (c, cur) => {
    if (!c.fight) return null;
    const v = c.fight(f);
    if (c.mode === "max") return Math.max(cur, v);
    if (c.mode === "streak") return v > 0 ? cur + v : 0;
    return v > 0 ? cur + v : null;
  });
}

/** Studying counts for the equipped champion: a reviewed card, a quiz at 80%+, and the study streak. */
export async function recordStudy(ctx: RequestContext, userId: number, event: StudyEvent | null, n = 1): Promise<string[]> {
  const a = await getAvatar(ctx, userId);
  if (a.championId === "hero") return [];                     // your hero isn't a champion: nothing to master
  const champion: Champion = isChampion(a.championId) ? a.championId : DEFAULT_CHAMPION;
  const streak = (await getProgress(ctx, userId)).streakDays;
  return advance(ctx, userId, champion, (c, cur) => {
    if (c.streak) return Math.max(cur, streak);
    if (event && c.study === event) return cur + n;
    return null;
  });
}
