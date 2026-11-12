// Focus mode (the two worlds, Stage 6): a finished focus session in Study (25 minutes) charges Insight - an edge in
// your next fight. Four a day count (the player's day); each is paid once (its slot is the idempotency key).
import { and, eq, like, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { rewardEvents, userProgress } from "../db/schema";
import { INSIGHT_MAX } from "./insight";
import { getProgress, localDate, recordRewardEvent, type Player } from "./store";

export const FOCUS_INSIGHT = 20, FOCUS_XP = 10, FOCUS_DAILY_CAP = 4;

export async function focusSession(ctx: RequestContext, p: Player) {
  const day = localDate(p.tz);
  const done = (await ctx.db.select({ n: sql<number>`count(*)` }).from(rewardEvents)
    .where(and(eq(rewardEvents.userId, p.id), eq(rewardEvents.kind, "focus_session"), like(rewardEvents.sourceId, `${day}:%`))).get())?.n ?? 0;
  if (done >= FOCUS_DAILY_CAP) {
    return { ok: true, counted: false, capped: true, sessions_today: done, insight: (await getProgress(ctx, p.id)).insight ?? 0 };
  }
  const slot = done + 1;
  const paid = await recordRewardEvent(ctx, p.id, "focus_session", FOCUS_XP, 0, `${day}:${slot}`, `u${p.id}:focus:${day}:${slot}`);
  if (paid.applied) {
    await ctx.db.update(userProgress).set({ insight: sql`MIN(${INSIGHT_MAX}, ${userProgress.insight} + ${FOCUS_INSIGHT})` }).where(eq(userProgress.userId, p.id));
  }
  return { ok: true, counted: paid.applied, capped: false, sessions_today: paid.applied ? slot : done, xp: paid.applied ? FOCUS_XP : 0,
    insight: (await getProgress(ctx, p.id)).insight ?? 0 };
}
