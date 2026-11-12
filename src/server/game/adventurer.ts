// The Adventurer card (the two worlds, Stage 7): one shareable card of who you are in the Hero world - your champion,
// level, power level, best Survival, Boss Rush clears, Bestiary progress, achievements and streak.
import { and, desc, eq, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { arenaGauntlets, user as userTable, userAchievements } from "../db/schema";
import { ACHIEVEMENTS } from "./content";
import { powerLevel } from "./power";
import { getAvatar, getProgress } from "./store";
import { TIER_OF } from "./tome";

export async function adventurerCard(ctx: RequestContext, userId: number) {
  const [progress, avatar, power, who] = await Promise.all([
    getProgress(ctx, userId), getAvatar(ctx, userId), powerLevel(ctx, userId),
    ctx.db.select({ name: userTable.username, display: userTable.name }).from(userTable).where(eq(userTable.id, userId)).get(),
  ]);
  const survival = (await ctx.db.select({ stage: arenaGauntlets.stage }).from(arenaGauntlets)
    .where(and(eq(arenaGauntlets.userId, userId), eq(arenaGauntlets.kind, "survival"), sql`${arenaGauntlets.status} != 'active'`))
    .orderBy(desc(arenaGauntlets.stage)).get())?.stage ?? 0;
  const rushWins = (await ctx.db.select({ n: sql<number>`count(*)` }).from(arenaGauntlets)
    .where(and(eq(arenaGauntlets.userId, userId), eq(arenaGauntlets.kind, "rush"), eq(arenaGauntlets.status, "won"))).get())?.n ?? 0;
  const unlocked = await ctx.db.select({ id: userAchievements.achievementId, at: userAchievements.unlockedAt }).from(userAchievements)
    .where(eq(userAchievements.userId, userId)).orderBy(desc(userAchievements.unlockedAt)).all();
  const nameOf = new Map(ACHIEVEMENTS.map((a) => [a.id, a.name]));
  return {
    ok: true,
    name: who?.name || who?.display || "Adventurer",
    champion: avatar.championId, level: progress.currentLevel, streak: progress.streakDays,
    power: power.power, survival_best: survival, rush_wins: rushWins,
    bestiary: { beaten: power.hunted.length, total: Object.keys(TIER_OF).length },
    achievements: { unlocked: unlocked.length, total: ACHIEVEMENTS.length, recent: unlocked.slice(0, 3).map((a) => nameOf.get(a.id) ?? a.id) },
  };
}
