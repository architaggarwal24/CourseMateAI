// Seasonal events (the two worlds, Stage 7): during a season (lib/game/seasons.ts) its limited boss can be fought - made
// of the concepts you met on a document in the last 30 days, on the season's own stage. Beating it pays once a season.
// An admin can preview a season out of its dates (to try it).
import { and, desc, eq, gte } from "drizzle-orm";
import type { RequestContext } from "../context";
import { conceptMastery, rewardEvents } from "../db/schema";
import { activeSeason, seasonById, seasonKey, SEASON_DAYS, SEASON_MIN_CONCEPTS, type Season } from "@/lib/game/seasons";
import { recordRewardEvent, type Player } from "./store";

const TARGETS = 5;

/** The season on now, or (admins only) the one asked to preview. */
export function seasonFor(preview: unknown, admin: boolean, now = new Date()): Season | null {
  if (admin && typeof preview === "string" && preview) return seasonById(preview);
  return activeSeason(now);
}

export async function monthConcepts(ctx: RequestContext, userId: number, docHash: string, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - SEASON_DAYS * 86400_000).toISOString();
  const rows = await ctx.db.select({ concept: conceptMastery.concept }).from(conceptMastery)
    .where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.docHash, docHash), gte(conceptMastery.lastSeenAt, since)))
    .orderBy(desc(conceptMastery.seen)).limit(TARGETS).all();
  return rows.map((r) => r.concept);
}

export async function beaten(ctx: RequestContext, userId: number, key: string) {
  return !!(await ctx.db.select({ id: rewardEvents.id }).from(rewardEvents)
    .where(and(eq(rewardEvents.userId, userId), eq(rewardEvents.kind, "season_boss"), eq(rewardEvents.sourceId, key))).get());
}

export async function seasonState(ctx: RequestContext, userId: number, docHash: string | null, season: Season | null) {
  if (!season) return { ok: true, season: null };
  const concepts = docHash ? await monthConcepts(ctx, userId, docHash) : [];
  return {
    ok: true, season: { id: season.id, name: season.name, tagline: season.tagline, boss: season.boss, boss_name: season.bossName, stage: season.stage, tint: season.tint, reward: season.reward },
    ready: concepts.length >= SEASON_MIN_CONCEPTS, concepts, needed: SEASON_MIN_CONCEPTS, beaten: await beaten(ctx, userId, seasonKey(season)),
  };
}

/** The season boss beaten: its bonus, once a season. */
export async function seasonWon(ctx: RequestContext, player: Player, season: Season) {
  const key = seasonKey(season);
  const paid = await recordRewardEvent(ctx, player.id, "season_boss", season.reward.xp, season.reward.coins, key, `u${player.id}:season:${key}`);
  return paid.applied ? { season: season.id, name: season.name, ...season.reward } : null;
}
