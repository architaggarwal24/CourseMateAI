// The Bestiary as progression (Stage B1): creature tiers that open from wins, the stand-in when a topic's creature is
// still locked, each creature's bane (a move combo: a clue first, written in after the first win), and the rewards
// for first defeats, banes found alone, mastery and new tiers. Records live in bestiary_records, one row per
// player and creature. The book itself (Stage B2) reads GET /bestiary.
import { and, eq, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { bestiaryRecords } from "../db/schema";
import { HttpError } from "../http";
import { CREATURES, NEMESIS_SPECIES } from "./bestiary";
import type { Boss } from "./boss";
import { recordRewardEvent } from "./store";

export type Move = "strike" | "jab" | "heavy" | "guard";
export type Mastery = "none" | "bronze" | "silver" | "gold";
export type RecordRow = typeof bestiaryRecords.$inferSelect;

/** Tiers: I is open from the start; beating any TIER_OPENS creatures of a tier opens the next. */
export const TIER_OF: Record<string, 1 | 2 | 3 | 4> = {
  minotaur: 1, cyclops: 1, oni: 1, kitsune: 1,
  naga: 2, rakshasa: 2, sphinx: 2, fenrir: 2,
  hydra: 3, kraken: 3, ammit: 3,
  simurgh: 4, jormungandr: 4,
};
export const TIERS = [1, 2, 3, 4] as const;
export const TIER_NAMES: Record<number, string> = { 1: "Beasts of the Wilds", 2: "Tricksters and Hunters", 3: "Ancient Horrors", 4: "World-Enders" };
export const TIER_OPENS = 2;
/** Higher tiers hit harder: more HP, a little less time, a heavier blow from tier III. */
export const TIER_HP = { 1: 1, 2: 1.15, 3: 1.3, 4: 1.5 } as const;
export const TIER_TIME = { 1: 1, 2: 0.93, 3: 0.86, 4: 0.8 } as const;
export const tierOf = (species: string): 1 | 2 | 3 | 4 => TIER_OF[species] ?? 1;
// (The extra damage per tier lives in boss.ts intentBaseDamage: +1 in rage at tier III, +1 always at IV.)

/** Each creature's bane: answering right with these moves, in this order, staggers it (x1.5 and it loses its turn). */
export const BANES: Record<string, { moves: Move[]; clue: string }> = {
  minotaur: { moves: ["guard", "heavy"], clue: "The bull charges blind. Stand your ground, then strike with all your weight." },
  cyclops: { moves: ["jab", "jab", "heavy"], clue: "One eye, slow to follow. Quick blows blur its sight; then the big one." },
  oni: { moves: ["guard", "guard", "strike"], clue: "Its drum beats twice. Wait out the rhythm, then answer it." },
  kitsune: { moves: ["jab", "strike"], clue: "Tricks fade under quick, honest blows: prod, then strike true." },
  naga: { moves: ["strike", "guard", "heavy"], clue: "Take the treasure, brace for the venom, then crush the coils." },
  rakshasa: { moves: ["guard", "jab", "heavy"], clue: "An illusion cracks when you hold, test it, then commit." },
  sphinx: { moves: ["strike", "strike", "strike"], clue: "Answer a riddle plainly, three times without faltering." },
  fenrir: { moves: ["jab", "jab", "jab"], clue: "Its chain was forged link by link. Many small blows." },
  hydra: { moves: ["heavy", "heavy"], clue: "Small cuts grow new heads. Only great blows, back to back, stop the growth." },
  kraken: { moves: ["guard", "strike", "heavy"], clue: "When the tentacles lock, endure, loosen the grip, then sever." },
  ammit: { moves: ["strike", "jab", "guard", "heavy"], clue: "Weigh the heart: strike, test, hold, then pass judgement." },
  simurgh: { moves: ["jab", "guard", "jab", "heavy"], clue: "Feathers fall to patience: pluck, wait, pluck, then the true blow." },
  jormungandr: { moves: ["heavy", "guard", "heavy"], clue: "The serpent tightens after each blow. Strike hard, brace, strike hard again." },
};
export const BANE_MULT = 1.5;

/** Rewards. First defeat by tier; a bane worked out alone; silver (5 wins) and gold (a flawless win on hard or
 *  nightmare, or any nightmare win) mastery. */
export const FIRST_WIN = { 1: { xp: 60, coins: 25 }, 2: { xp: 120, coins: 50 }, 3: { xp: 200, coins: 80 }, 4: { xp: 320, coins: 130 } } as const;
export const BANE_FOUND = { xp: 80, coins: 40 };
export const MASTERY_REWARD = { silver: { xp: 0, coins: 60 }, gold: { xp: 150, coins: 120 } } as const;
export const SILVER_WINS = 5;
const RANK: Record<Mastery, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };

export function masteryOf(r: Pick<RecordRow, "wins" | "flawlessWins" | "nightmareWins"> | undefined): Mastery {
  if (!r || r.wins < 1) return "none";
  if (r.flawlessWins > 0 || r.nightmareWins > 0) return "gold";
  return r.wins >= SILVER_WINS ? "silver" : "bronze";
}

const now = () => new Date().toISOString();

export async function records(ctx: RequestContext, userId: number): Promise<Map<string, RecordRow>> {
  const rows = await ctx.db.select().from(bestiaryRecords).where(eq(bestiaryRecords.userId, userId)).all();
  return new Map(rows.map((r) => [r.species, r]));
}

/** Which tiers are open, from the creatures beaten. */
export function openTiers(recs: Map<string, RecordRow>): Set<number> {
  const open = new Set<number>([1]);
  for (const t of [2, 3, 4]) {
    if (!open.has(t - 1)) break;
    const beaten = Object.keys(TIER_OF).filter((s) => TIER_OF[s] === t - 1 && (recs.get(s)?.wins ?? 0) > 0).length;
    if (beaten >= TIER_OPENS) open.add(t); else break;
  }
  return open;
}

/** Every creature of a tier a topic can summon is beaten (the Nemesis does not count: no topic calls it). */
export function tierFinished(recs: Map<string, RecordRow>, tier: number): boolean {
  const members = Object.keys(TIER_OF).filter((s) => TIER_OF[s] === tier && s !== NEMESIS_SPECIES);
  return members.length > 0 && members.every((s) => (recs.get(s)?.wins ?? 0) > 0);
}
export const finishedTiers = (recs: Map<string, RecordRow>) => TIERS.filter((t) => tierFinished(recs, t));

/** The creatures a topic may summon now (the Nemesis is never summoned by a topic). */
export function openSpecies(recs: Map<string, RecordRow>): Set<string> {
  const tiers = openTiers(recs);
  return new Set(Object.keys(TIER_OF).filter((s) => s !== NEMESIS_SPECIES && tiers.has(TIER_OF[s])));
}

/** A topic summoned a locked creature: its page remembers the topic (the teaser). */
export async function noteTeaser(ctx: RequestContext, userId: number, species: string, topic: string): Promise<void> {
  const t = now();
  await ctx.db.insert(bestiaryRecords).values({ userId, species, teaserTopic: topic.slice(0, 80), updatedAt: t })
    .onConflictDoUpdate({ target: [bestiaryRecords.userId, bestiaryRecords.species], set: { teaserTopic: topic.slice(0, 80), updatedAt: t } });
}

/** Whether the bane is written in: only after the first win (finding it alone earns a reward, not the text). */
export const baneKnown = (r: RecordRow | undefined) => !!r && r.wins > 0;

// ── in a fight ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Track the player's moves (right answers in a row) and say when the last ones complete the bane. The sequence is
 * kept in boss.mods.bane_seq; a wrong answer or a landed bane starts it over.
 */
export function trackBane(boss: Boss, move: string, correct: boolean): boolean {
  const bane = BANES[String(boss.species ?? "")];
  const mods = (boss.mods ??= {});
  if (!bane || !correct) { mods.bane_seq = []; return false; }
  const seq: string[] = [...(mods.bane_seq ?? []), move].slice(-bane.moves.length);
  const hit = seq.length === bane.moves.length && seq.every((m, i) => m === bane.moves[i]);
  mods.bane_seq = hit ? [] : seq;
  return hit;
}

/** The bane as the battle screen shows it: the combo and progress once known, else only the clue. */
export function baneHud(boss: Boss) {
  const bane = BANES[String(boss.species ?? "")];
  if (!bane) return null;
  if (!boss.bane_known) return { known: false, clue: bane.clue, moves: null, progress: 0 };
  const seq: string[] = boss.mods?.bane_seq ?? [];
  // how much of the combo the moves so far already match (the longest suffix that is a prefix of it)
  let progress = 0;
  for (let k = Math.min(seq.length, bane.moves.length - 1); k > 0; k--) {
    if (seq.slice(-k).every((m, i) => m === bane.moves[i])) { progress = k; break; }
  }
  return { known: true, clue: bane.clue, moves: bane.moves, progress };
}

/** A bane landed before the first win: the player worked it out. Paid once per creature. */
export async function baneLanded(ctx: RequestContext, userId: number, species: string): Promise<{ found: boolean }> {
  const t = now();
  await ctx.db.insert(bestiaryRecords).values({ userId, species, updatedAt: t }).onConflictDoNothing();
  const won = await ctx.db.update(bestiaryRecords).set({ baneFound: true, baneUses: sql`${bestiaryRecords.baneUses} + 1`, updatedAt: t })
    .where(and(eq(bestiaryRecords.userId, userId), eq(bestiaryRecords.species, species), eq(bestiaryRecords.wins, 0), eq(bestiaryRecords.baneFound, false)))
    .returning({ s: bestiaryRecords.species }).all();
  if (!won.length) {
    await ctx.db.update(bestiaryRecords).set({ baneUses: sql`${bestiaryRecords.baneUses} + 1`, updatedAt: t })
      .where(and(eq(bestiaryRecords.userId, userId), eq(bestiaryRecords.species, species)));
    return { found: false };
  }
  await recordRewardEvent(ctx, userId, "bestiary_bane", BANE_FOUND.xp, BANE_FOUND.coins, species, `u${userId}:bestiary:bane:${species}`);
  return { found: true };
}

// ── after a fight ─────────────────────────────────────────────────────────────────────────────────────────────
export interface FightResult {
  species: string; tier: number; won: boolean; first_win: boolean; flawless: boolean;
  mastery: Mastery; mastery_up: Mastery | null; tier_opened: number | null;
  /** Tiers this fight finished (every creature beaten): each one brings a champion (roster.ts). */
  tiers_finished: number[];
  rewards: { xp: number; coins: number };
}

/** Count a finished fight against a creature, and pay what it earned (each reward once, by its ledger key). */
export async function recordFight(ctx: RequestContext, userId: number, o: {
  species: string; won: boolean; flawless: boolean; nightmare: boolean; seconds: number; accuracy: number;
}): Promise<FightResult | null> {
  const { species, won } = o;
  if (!TIER_OF[species]) return null;
  const before = await records(ctx, userId);
  const tiersBefore = openTiers(before);
  const t = now();
  const prev = before.get(species);
  await ctx.db.insert(bestiaryRecords).values({ userId, species, updatedAt: t }).onConflictDoNothing();
  await ctx.db.update(bestiaryRecords).set({
    fights: sql`${bestiaryRecords.fights} + 1`,
    wins: sql`${bestiaryRecords.wins} + ${won ? 1 : 0}`,
    losses: sql`${bestiaryRecords.losses} + ${won ? 0 : 1}`,
    flawlessWins: sql`${bestiaryRecords.flawlessWins} + ${won && o.flawless ? 1 : 0}`,
    nightmareWins: sql`${bestiaryRecords.nightmareWins} + ${won && o.nightmare ? 1 : 0}`,
    ...(won ? {
      bestSeconds: sql`MIN(COALESCE(${bestiaryRecords.bestSeconds}, ${o.seconds}), ${o.seconds})`,
      bestAccuracy: sql`MAX(COALESCE(${bestiaryRecords.bestAccuracy}, ${o.accuracy}), ${o.accuracy})`,
      firstWinAt: sql`COALESCE(${bestiaryRecords.firstWinAt}, ${t})`,
    } : {}),
    lastFoughtAt: t, updatedAt: t,
  }).where(and(eq(bestiaryRecords.userId, userId), eq(bestiaryRecords.species, species)));
  const after = await records(ctx, userId);
  const r = after.get(species)!;
  const tier = tierOf(species);
  const rewards = { xp: 0, coins: 0 };
  const pay = async (kind: string, xp: number, coins: number, key: string) => {
    const res = await recordRewardEvent(ctx, userId, kind, xp, coins, species, `u${userId}:bestiary:${key}:${species}`);
    if (res.applied) { rewards.xp += xp; rewards.coins += coins; }
  };
  const firstWin = won && (prev?.wins ?? 0) === 0;
  if (firstWin) await pay("bestiary_first_win", FIRST_WIN[tier].xp, FIRST_WIN[tier].coins, "first");
  // mastery: pay each step up once (bronze is the first win itself)
  const mastery = masteryOf(r);
  let masteryUp: Mastery | null = null;
  if (RANK[mastery] > RANK[(r.masteryPaid as Mastery) ?? "none"]) {
    const claimed = await ctx.db.update(bestiaryRecords).set({ masteryPaid: mastery })
      .where(and(eq(bestiaryRecords.userId, userId), eq(bestiaryRecords.species, species), eq(bestiaryRecords.masteryPaid, r.masteryPaid)))
      .returning({ s: bestiaryRecords.species }).all();
    if (claimed.length) {
      masteryUp = mastery;
      for (const step of ["silver", "gold"] as const) {
        if (RANK[mastery] >= RANK[step] && RANK[(r.masteryPaid as Mastery) ?? "none"] < RANK[step]) {
          await pay(`bestiary_${step}`, MASTERY_REWARD[step].xp, MASTERY_REWARD[step].coins, step);
        }
      }
    }
  }
  const tiersAfter = openTiers(after);
  const opened = [...tiersAfter].find((x) => !tiersBefore.has(x)) ?? null;
  const finished = TIERS.filter((x) => tierFinished(after, x) && !tierFinished(before, x));
  return { species, tier, won, first_win: firstWin, flawless: won && o.flawless, mastery, mastery_up: masteryUp, tier_opened: opened, tiers_finished: finished, rewards };
}

/** Counts for achievements: banes found alone, creatures beaten. */
export async function bestiaryStats(ctx: RequestContext, userId: number) {
  const recs = await records(ctx, userId);
  let banes = 0, beaten = 0;
  for (const r of recs.values()) { if (r.baneFound) banes++; if (r.wins > 0) beaten++; }
  return { bestiary_banes_found: banes, bestiary_creatures_defeated: beaten };
}

// ── the book's data ───────────────────────────────────────────────────────────────────────────────────────────
function entry(species: string, r: RecordRow | undefined, tiers: Set<number>) {
  const c = CREATURES[species];
  const tier = tierOf(species);
  const open = tiers.has(tier) || (species === NEMESIS_SPECIES && (r?.fights ?? 0) > 0);
  const known = baneKnown(r);
  const bane = BANES[species];
  return {
    species, tier, open, met: (r?.fights ?? 0) > 0, defeated: (r?.wins ?? 0) > 0,
    // a locked page is a silhouette: no name or story until its tier opens
    name: open ? c.name : null, origin: open ? c.origin : null,
    teaser_topic: !open ? r?.teaserTopic ?? null : null,
    record: r ? {
      fights: r.fights, wins: r.wins, losses: r.losses, flawless_wins: r.flawlessWins, nightmare_wins: r.nightmareWins,
      best_seconds: r.bestSeconds, best_accuracy: r.bestAccuracy, first_win_at: r.firstWinAt, last_fought_at: r.lastFoughtAt,
    } : null,
    mastery: masteryOf(r),
    bane: open ? { clue: bane.clue, moves: known ? bane.moves : null, found_alone: !!r?.baneFound, uses: r?.baneUses ?? 0 } : null,
    // a Hunt's reward (scrolls.ts): the extra page of lore
    lost_page: open && !!r?.lostPage,
    // the stat block of an open page (round 7): its blows, its special, how much tougher its tier is
    stats: open ? { attacks: [...c.attacks], special: c.special, hp_scale: TIER_HP[tier], time_scale: TIER_TIME[tier] } : null,
  };
}

/** GET /bestiary: every page, in tier order, and the tiers' state. */
export async function bestiaryView(ctx: RequestContext, userId: number) {
  const recs = await records(ctx, userId);
  const tiers = openTiers(recs);
  return {
    tiers: TIERS.map((t) => {
      const members = Object.keys(TIER_OF).filter((s) => TIER_OF[s] === t);
      const beaten = members.filter((s) => (recs.get(s)?.wins ?? 0) > 0).length;
      return { tier: t, name: TIER_NAMES[t], open: tiers.has(t), beaten, total: members.length, opens_next_at: t < 4 ? TIER_OPENS : null };
    }),
    creatures: Object.keys(TIER_OF).map((s) => entry(s, recs.get(s), tiers)),
  };
}

/** GET /bestiary/{species}: one page, with the concepts this creature has tested the player on. */
export async function bestiaryPage(ctx: RequestContext, userId: number, species: string) {
  if (!TIER_OF[species]) throw new HttpError(404, "creature_not_found", "There's no such creature in the Bestiary.");
  const recs = await records(ctx, userId);
  const page = entry(species, recs.get(species), openTiers(recs));
  if (!page.open) return { ...page, concepts: [] };
  const rows = await ctx.env.DB.prepare(
    "SELECT q.concept_key AS k, MAX(json_extract(q.question_json, '$.concept')) AS name, COUNT(*) AS asked, SUM(q.correct) AS right " +
    "FROM arena_questions q JOIN arena_battles b ON b.id = q.battle_id " +
    "WHERE b.user_id = ?1 AND json_extract(b.boss_json, '$.species') = ?2 AND q.status = 'answered' " +
    "GROUP BY q.concept_key ORDER BY asked DESC, k LIMIT 8",
  ).bind(userId, species).all<{ k: string; name: string | null; asked: number; right: number | null }>();
  const concepts = (rows.results ?? []).map((r) => ({ concept: r.name || r.k, asked: Number(r.asked), right: Number(r.right ?? 0) }));
  return { ...page, concepts };
}
