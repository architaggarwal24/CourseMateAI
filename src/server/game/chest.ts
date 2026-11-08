// The daily chest (Stage R3): once a day (the player's day), a chest with a random reward. Coins always (more at
// higher levels), often a potion, now and then a skin the player doesn't own yet; a streak of days in a row adds up
// to double coins. One ledger event per day (its key is the day), so it can't be opened twice.
import { and, desc, eq } from "drizzle-orm";
import type { RequestContext } from "../context";
import { rewardEvents } from "../db/schema";
import { HttpError } from "../http";
import { CATALOG } from "./content";
import { addInventory, getAvatar, getProgress, localDate, modifyAvatar, recordRewardEvent, type Player } from "./store";

export const CHEST_POTIONS = ["potion_health_small", "fifty_fifty"];
export const POTION_CHANCE = 0.4;
export const SKIN_CHANCE = 0.08;
export const STREAK_STEP = 0.1;
export const STREAK_MAX = 1;

const prevDay = (day: string) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/** Coins for a level before the streak bonus: 30 to 80, more as you level up. */
export const baseCoins = (level: number, roll: number) => Math.round(30 + Math.min(level, 30) * 1.5 + roll * 20);

/** The last chests opened (the day each was opened on is its source). */
async function history(ctx: RequestContext, userId: number) {
  return ctx.db.select({ day: rewardEvents.sourceId }).from(rewardEvents)
    .where(and(eq(rewardEvents.userId, userId), eq(rewardEvents.kind, "daily_chest"))).orderBy(desc(rewardEvents.id)).limit(40).all();
}

/** Days in a row a chest was opened, up to and including `day` (or yesterday, when today's is still closed). */
export function streakOf(days: (string | null)[], day: string): number {
  const set = new Set(days.filter(Boolean) as string[]);
  let d = set.has(day) ? day : prevDay(day);
  let n = 0;
  while (set.has(d)) { n++; d = prevDay(d); }
  return n;
}

/** GET /chest: is today's chest still closed, and how long is the streak. */
export async function chestState(ctx: RequestContext, p: Player) {
  const day = localDate(p.tz);
  const days = (await history(ctx, p.id)).map((r) => r.day);
  const openedToday = days.includes(day);
  const streak = streakOf(days, day);
  const nextStreak = openedToday ? streak : streak + 1;
  return { available: !openedToday, day, streak, bonus_pct: Math.round(Math.min(STREAK_MAX, STREAK_STEP * Math.max(0, nextStreak - 1)) * 100) };
}

/** POST /chest/open: today's chest, once. `rng` is for tests. */
export async function openChest(ctx: RequestContext, p: Player, rng: () => number = Math.random) {
  const day = localDate(p.tz);
  const days = (await history(ctx, p.id)).map((r) => r.day);
  if (days.includes(day)) throw new HttpError(409, "chest_opened", "You've opened today's chest. A new one comes tomorrow.");
  const streak = streakOf(days, day) + 1;
  const bonus = Math.min(STREAK_MAX, STREAK_STEP * (streak - 1));
  const level = (await getProgress(ctx, p.id)).currentLevel;
  const coins = Math.round(baseCoins(level, rng()) * (1 + bonus));
  const paid = await recordRewardEvent(ctx, p.id, "daily_chest", 0, coins, day, `u${p.id}:chest:${day}`);
  if (!paid.applied) throw new HttpError(409, "chest_opened", "You've opened today's chest. A new one comes tomorrow.");
  const items: { id: string; name: string; kind: "potion" | "skin" }[] = [];
  if (rng() < POTION_CHANCE) {
    const id = CHEST_POTIONS[Math.floor(rng() * CHEST_POTIONS.length)];
    await addInventory(ctx, p.id, id, 1);
    items.push({ id, name: CATALOG.find((c) => c.id === id)?.name ?? id, kind: "potion" });
  }
  if (rng() < SKIN_CHANCE) {
    const owned = new Set((await getAvatar(ctx, p.id)).owned);
    const pool = CATALOG.filter((c) => ["armor", "headgear", "weapon"].includes(c.type) && !c.mastery && c.price > 0 && c.price <= 600 && !owned.has(c.id));
    if (pool.length) {
      const skin = pool[Math.floor(rng() * pool.length)];
      await modifyAvatar(ctx, p.id, (_e, o) => { if (!o.includes(skin.id)) o.push(skin.id); });
      items.push({ id: skin.id, name: skin.name, kind: "skin" });
    }
  }
  return { ok: true, day, streak, bonus_pct: Math.round(bonus * 100), coins, items, totals: { coins: paid.coins, total_xp: paid.total_xp, level: paid.level } };
}
