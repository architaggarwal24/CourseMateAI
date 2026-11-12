// Insight (the two worlds, Stage 5): studying fills it, up to 100. Full, your next fight starts with an edge - one
// extra Focus and a free 50/50 - and Insight empties. Study helps you in the Hero world without gating anything.
import { and, eq, gte, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { userProgress } from "../db/schema";
import type { RewardAction } from "./content";

export const INSIGHT_MAX = 100;
/** How much each kind of studying fills it (what the reward pays for; capped like the rewards are). */
export const INSIGHT_GAIN: Partial<Record<RewardAction, number>> = {
  quiz_complete: 25, review_complete: 20, flashcard_complete: 15, exam_complete: 35, notes_generation: 10, chat_bundle_5: 10,
};

export async function addInsight(ctx: RequestContext, userId: number, action: RewardAction) {
  const n = INSIGHT_GAIN[action];
  if (!n) return;
  await ctx.db.update(userProgress).set({ insight: sql`MIN(${INSIGHT_MAX}, ${userProgress.insight} + ${n})` }).where(eq(userProgress.userId, userId));
}

/** A fight starts: if Insight is full, it is spent (once: compare-and-set) and the fight gets its edge. */
export async function takeInsight(ctx: RequestContext, userId: number): Promise<boolean> {
  const done = await ctx.db.update(userProgress).set({ insight: 0 })
    .where(and(eq(userProgress.userId, userId), gte(userProgress.insight, INSIGHT_MAX))).returning({ id: userProgress.userId }).all();
  return done.length > 0;
}
