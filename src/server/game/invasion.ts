// The weekly invasion (the two worlds, Stage 5): every week a creature comes for what you studied - a boss built from
// the concepts you met this week on a document (at least 3). It shows as a quest in the Hero world and a hint on
// Today. Beating it repels the invasion for the week (a bonus, once).
import { and, desc, eq, gte } from "drizzle-orm";
import type { RequestContext } from "../context";
import { conceptMastery, rewardEvents } from "../db/schema";
import { seeded } from "./expedition";
import { weekStart } from "./arena";
import { CREATURES } from "./bestiary";
import { recordRewardEvent, type Player } from "./store";

export const INVASION_MIN = 3, INVASION_TARGETS = 5;
export const INVASION_REWARD = { xp: 120, coins: 150 };
const NEMESIS = "ammit";

/** This week's key (the Monday it started, UTC). */
export const weekKey = (now = new Date()) => weekStart(now).toISOString().slice(0, 10);

/** The concepts you met this week on a document, most seen first. */
export async function weekConcepts(ctx: RequestContext, userId: number, docHash: string, now = new Date()): Promise<string[]> {
  const rows = await ctx.db.select({ concept: conceptMastery.concept }).from(conceptMastery)
    .where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.docHash, docHash), gte(conceptMastery.lastSeenAt, weekStart(now).toISOString())))
    .orderBy(desc(conceptMastery.seen)).limit(INVASION_TARGETS).all();
  return rows.map((r) => r.concept);
}

/** This week's invader for you: a creature you can face (one whose Bestiary tier is open), the same all week. */
export function invader(userId: number, week: string, open: Set<string>): string {
  const pool = [...open].filter((s) => s !== NEMESIS).sort();
  return seeded(`invasion:${userId}:${week}`).choice(pool.length ? pool : ["minotaur"]);
}

export async function repelled(ctx: RequestContext, userId: number, week: string): Promise<boolean> {
  return !!(await ctx.db.select({ id: rewardEvents.id }).from(rewardEvents)
    .where(and(eq(rewardEvents.userId, userId), eq(rewardEvents.kind, "invasion_repelled"), eq(rewardEvents.sourceId, week))).get());
}

/** The invasion on a document this week: ready (enough studied), who it is, what it's made of, already repelled. */
export async function invasionState(ctx: RequestContext, userId: number, docHash: string | null, open: Set<string>) {
  const week = weekKey();
  const concepts = docHash ? await weekConcepts(ctx, userId, docHash) : [];
  const species = invader(userId, week, open);
  return {
    ok: true, week, ready: concepts.length >= INVASION_MIN, concepts, needed: INVASION_MIN,
    species, name: CREATURES[species]?.name ?? species, repelled: await repelled(ctx, userId, week), reward: INVASION_REWARD,
  };
}

/** An invasion fight was won: the week's bonus, once. */
export async function repel(ctx: RequestContext, player: Player) {
  const week = weekKey();
  const paid = await recordRewardEvent(ctx, player.id, "invasion_repelled", INVASION_REWARD.xp, INVASION_REWARD.coins, week, `u${player.id}:invasion:${week}`);
  return paid.applied ? { week, ...INVASION_REWARD } : null;
}
