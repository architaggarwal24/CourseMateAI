// The game's storage (Stage 4.5; port of backend/services/progression/db.py) on D1.
// D1 has no interactive transactions, so every "both or neither" write is one `batch` (atomic) or one guarded
// statement; a guard that didn't apply is how a race, a replay or an empty purse is detected.
import { and, eq, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { dailyActionCounts, rewardEvents, userAvatar, userInventory, userProgress, user as userTable } from "../db/schema";
import { levelFromTotalXp } from "./content";

export type Progress = typeof userProgress.$inferSelect;
export const nowIso = () => new Date().toISOString();

// ── the player's day ─────────────────────────────────────────────────────────────────────────────────────────
export function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** The calendar date (YYYY-MM-DD) in `tz` (UTC when unknown). */
export function localDate(tz: string | null | undefined, now = new Date()): string {
  const zone = validTimezone(tz) ? tz : "UTC";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface Player { id: number; tz: string | null }

export async function userToday(ctx: RequestContext, p: Player): Promise<string> {
  return localDate(p.tz);
}

/** The browser says where it is (x-timezone): a player's day follows them. */
export async function syncTimezone(ctx: RequestContext, userId: number, current: string | null, req: Request): Promise<string | null> {
  const tz = req.headers.get("x-timezone");
  if (!validTimezone(tz) || tz === current) return current;
  await ctx.db.update(userTable).set({ timezone: tz }).where(eq(userTable.id, userId));
  return tz;
}

// ── progress ─────────────────────────────────────────────────────────────────────────────────────────────────
export async function ensureUser(ctx: RequestContext, userId: number): Promise<void> {
  const t = nowIso();
  await ctx.db.batch([
    ctx.db.insert(userProgress).values({ userId, createdAt: t, updatedAt: t }).onConflictDoNothing(),
    ctx.db.insert(userAvatar).values({ userId, createdAt: t, updatedAt: t }).onConflictDoNothing(),
  ]);
}

export async function getProgress(ctx: RequestContext, userId: number): Promise<Progress> {
  let row = await ctx.db.select().from(userProgress).where(eq(userProgress.userId, userId)).get();
  if (!row) {
    await ensureUser(ctx, userId);
    row = (await ctx.db.select().from(userProgress).where(eq(userProgress.userId, userId)).get())!;
  }
  return row;
}

/** The API's snake_case view of a progress row. */
export function progressView(p: Progress) {
  return {
    user_id: String(p.userId), total_xp: p.totalXp, current_level: p.currentLevel, coins: p.coins, streak_days: p.streakDays,
    last_active_utc: p.lastActiveUtc, streak_freezes: p.streakFreezes, total_arena_rounds: p.totalArenaRounds,
    total_bosses_defeated: p.totalBossesDefeated, total_quizzes_completed: p.totalQuizzesCompleted,
    total_chat_questions: p.totalChatQuestions, total_chat_bundles: p.totalChatBundles, total_notes_generated: p.totalNotesGenerated,
    total_flashcards_studied: p.totalFlashcardsStudied, best_quiz_accuracy: p.bestQuizAccuracy,
    nightmare_bosses_defeated: p.nightmareBossesDefeated, created_at: p.createdAt, updated_at: p.updatedAt,
  };
}

type Counter = "totalArenaRounds" | "totalBossesDefeated" | "totalQuizzesCompleted" | "totalChatQuestions" | "totalChatBundles"
  | "totalNotesGenerated" | "totalFlashcardsStudied" | "nightmareBossesDefeated";

export async function incrementProgress(ctx: RequestContext, userId: number, field: Counter, amount = 1): Promise<number> {
  const col = userProgress[field];
  const row = await ctx.db.update(userProgress).set({ [field]: sql`${col} + ${amount}`, updatedAt: nowIso() })
    .where(eq(userProgress.userId, userId)).returning({ v: col }).get();
  return Number(row?.v ?? 0);
}

export async function setProgress(ctx: RequestContext, userId: number, fields: Partial<Pick<Progress, "streakDays" | "lastActiveUtc" | "streakFreezes" | "bestQuizAccuracy">>) {
  await ctx.db.update(userProgress).set({ ...fields, updatedAt: nowIso() }).where(eq(userProgress.userId, userId));
}

// ── the reward ledger ────────────────────────────────────────────────────────────────────────────────────────
export interface LedgerResult { applied: boolean; reason?: "duplicate" | "insufficient_funds"; total_xp: number; coins: number; level: number }

/**
 * Append one event to reward_events and apply it to the cached totals, atomically (one D1 batch). The only way
 * XP / coins / level change. `key` is UNIQUE: the same key again changes nothing (reason "duplicate"). An event
 * that would take XP or coins below zero (a purchase the player can't afford) is refused ("insufficient_funds").
 */
export async function recordRewardEvent(ctx: RequestContext, userId: number, kind: string, xp: number, coins: number,
  sourceId: string | null, key: string): Promise<LedgerResult> {
  await ensureUser(ctx, userId);
  const t = nowIso();
  const db = ctx.env.DB;
  const [inserted] = await db.batch([
    db.prepare(
      "INSERT INTO reward_events (user_id, kind, xp, coins, source_id, idempotency_key, created_at) " +
      "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE EXISTS (SELECT 1 FROM user_progress WHERE user_id = ?1 AND total_xp + ?3 >= 0 AND coins + ?4 >= 0) " +
      "ON CONFLICT(idempotency_key) DO NOTHING",
    ).bind(userId, kind, Math.trunc(xp), Math.trunc(coins), sourceId, key, t),
    // applies only if the insert above did (changes() is the previous statement's row count)
    db.prepare("UPDATE user_progress SET total_xp = total_xp + ?2, coins = coins + ?3, updated_at = ?4 WHERE user_id = ?1 AND changes() = 1")
      .bind(userId, Math.trunc(xp), Math.trunc(coins), t),
  ]);
  const applied = (inserted.meta?.changes ?? 0) === 1;
  let p = await getProgress(ctx, userId);
  if (applied) {
    const level = levelFromTotalXp(p.totalXp);
    if (level !== p.currentLevel) {
      await ctx.db.update(userProgress).set({ currentLevel: level }).where(eq(userProgress.userId, userId));
      p = { ...p, currentLevel: level };
    }
    return { applied, total_xp: p.totalXp, coins: p.coins, level: p.currentLevel };
  }
  const dup = await ctx.db.select({ id: rewardEvents.id }).from(rewardEvents).where(eq(rewardEvents.idempotencyKey, key)).get();
  return { applied, reason: dup ? "duplicate" : "insufficient_funds", total_xp: p.totalXp, coins: p.coins, level: p.currentLevel };
}

export async function countRewardEvents(ctx: RequestContext, userId: number, kind: string, sourceId?: string): Promise<number> {
  const r = await ctx.db.select({ n: sql<number>`COUNT(*)` }).from(rewardEvents).where(and(
    eq(rewardEvents.userId, userId), eq(rewardEvents.kind, kind), ...(sourceId === undefined ? [] : [eq(rewardEvents.sourceId, sourceId)]))).get();
  return Number(r?.n ?? 0);
}

// ── daily action counts (caps) ───────────────────────────────────────────────────────────────────────────────
export async function dailyCount(ctx: RequestContext, userId: number, day: string, action: string): Promise<number> {
  const r = await ctx.db.select({ c: dailyActionCounts.count }).from(dailyActionCounts)
    .where(and(eq(dailyActionCounts.userId, userId), eq(dailyActionCounts.day, day), eq(dailyActionCounts.actionType, action))).get();
  return r?.c ?? 0;
}

/** Count one more; with `cap`, only while under it. The new count, or null when the cap was already reached. */
export async function takeDailySlot(ctx: RequestContext, userId: number, day: string, action: string, cap?: number): Promise<number | null> {
  const t = nowIso();
  const q = ctx.db.insert(dailyActionCounts).values({ userId, day, actionType: action, count: 1, lastTs: t }).onConflictDoUpdate({
    target: [dailyActionCounts.userId, dailyActionCounts.day, dailyActionCounts.actionType],
    set: { count: sql`${dailyActionCounts.count} + 1`, lastTs: t },
    ...(cap ? { setWhere: sql`${dailyActionCounts.count} < ${cap}` } : {}),
  }).returning({ c: dailyActionCounts.count });
  const row = await q.get();
  return row ? row.c : null;
}

/** Give back one count taken with takeDailySlot (the thing it was for didn't happen). */
export async function releaseDailySlot(ctx: RequestContext, userId: number, day: string, action: string): Promise<void> {
  await ctx.db.update(dailyActionCounts).set({ count: sql`max(${dailyActionCounts.count} - 1, 0)` })
    .where(and(eq(dailyActionCounts.userId, userId), eq(dailyActionCounts.day, day), eq(dailyActionCounts.actionType, action)));
}

// ── avatar and inventory ─────────────────────────────────────────────────────────────────────────────────────
export interface Avatar { equipped: Record<string, string>; owned: string[]; championId: string | null; championSetAt: string | null; updatedAt: string }

export async function getAvatar(ctx: RequestContext, userId: number): Promise<Avatar> {
  let row = await ctx.db.select().from(userAvatar).where(eq(userAvatar.userId, userId)).get();
  if (!row) { await ensureUser(ctx, userId); row = (await ctx.db.select().from(userAvatar).where(eq(userAvatar.userId, userId)).get())!; }
  const parse = <T,>(s: string, d: T): T => { try { return JSON.parse(s) ?? d; } catch { return d; } };
  return { equipped: parse(row.equippedJson, {}), owned: parse(row.ownedJson, []), championId: row.championId, championSetAt: row.championSetAt, updatedAt: row.updatedAt };
}

/**
 * Change owned / equipped with `mutate`, then save, unless someone else saved in between (then try again):
 * a purchase and a free-item grant racing can't overwrite each other.
 */
export async function modifyAvatar(ctx: RequestContext, userId: number, mutate: (equipped: Record<string, string>, owned: string[]) => void,
  extra: Partial<{ championId: string; championSetAt: string }> = {}): Promise<Avatar> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const a = await getAvatar(ctx, userId);
    mutate(a.equipped, a.owned);
    const t = nowIso();
    const done = await ctx.db.update(userAvatar).set({ equippedJson: JSON.stringify(a.equipped), ownedJson: JSON.stringify(a.owned), updatedAt: t, ...extra })
      .where(and(eq(userAvatar.userId, userId), eq(userAvatar.updatedAt, a.updatedAt))).returning({ u: userAvatar.userId }).all();
    if (done.length) return { ...a, ...(extra.championId ? { championId: extra.championId, championSetAt: extra.championSetAt ?? a.championSetAt } : {}), updatedAt: t };
  }
  throw new Error("avatar busy");
}

export async function inventory(ctx: RequestContext, userId: number): Promise<Record<string, number>> {
  const rows = await ctx.db.select().from(userInventory).where(eq(userInventory.userId, userId)).all();
  return Object.fromEntries(rows.filter((r) => r.quantity > 0).map((r) => [r.itemId, r.quantity]));
}

export async function addInventory(ctx: RequestContext, userId: number, itemId: string, n = 1) {
  await ctx.db.insert(userInventory).values({ userId, itemId, quantity: n })
    .onConflictDoUpdate({ target: [userInventory.userId, userInventory.itemId], set: { quantity: sql`${userInventory.quantity} + ${n}` } });
}

/** Use one: true only if there was one to use. */
export async function consumeInventory(ctx: RequestContext, userId: number, itemId: string): Promise<boolean> {
  const r = await ctx.db.update(userInventory).set({ quantity: sql`${userInventory.quantity} - 1` })
    .where(and(eq(userInventory.userId, userId), eq(userInventory.itemId, itemId), sql`${userInventory.quantity} >= 1`)).returning({ q: userInventory.quantity }).all();
  return r.length === 1;
}
