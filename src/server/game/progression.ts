// XP, coins, levels, streaks, daily quests, achievements and buffs (Stage 4.5; ports of backend/services/progression:
// reward_service, streak_service, quest_service, achievement_service, buff_service). Every payout is one ledger
// event with a unique key (store.recordRewardEvent), so nothing can be paid twice.
import { STUDY_SHARE as HERO_STUDY_SHARE, addXp as addHeroXp, xpBoost as heroXpBoost } from "./build";
import { addInsight } from "./insight";
import { scrollEvent } from "./scrolls";
import { bestiaryStats } from "./tome";
import { and, eq, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { dailyQuests, userAchievements, userBuffs } from "../db/schema";
import {
  ACHIEVEMENTS, ITEMS, REWARD_ACTIONS, dailyQuestPool, rewards as REWARDS, xpProgress, type AchievementDef, type ItemBonus, type RewardAction,
} from "./content";
import {
  getAvatar, getProgress, incrementProgress, localDate, modifyAvatar, nowIso, recordRewardEvent, setProgress, takeDailySlot, type Player,
  type Progress,
} from "./store";
import { canUseItem } from "./items";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const num = (v: unknown, d: number) => { const n = Number(v); return v === null || v === undefined || !Number.isFinite(n) ? d : n; };
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ── streaks ──────────────────────────────────────────────────────────────────────────────────────────────────
/** Count today as active. Each missed day costs one freeze; every 7th day earns one. The streak. */
export async function updateStreak(ctx: RequestContext, p: Player): Promise<number> {
  const prog = await getProgress(ctx, p.id);
  const today = localDate(p.tz);
  const last = prog.lastActiveUtc;
  const streak = prog.streakDays;
  let freezes = prog.streakFreezes;
  if (last === today) return streak;
  let next: number;
  if (last === addDays(today, -1)) next = streak + 1;
  else {
    let missed = 1;
    if (last) { const d = daysBetween(String(last).slice(0, 10), today); missed = Number.isFinite(d) ? Math.max(1, d - 1) : 1; }
    if (last && freezes >= missed) { freezes -= missed; next = streak; } else next = 1;
  }
  if (next > streak && next % 7 === 0) freezes += 1;
  await setProgress(ctx, p.id, { streakDays: next, lastActiveUtc: today, streakFreezes: freezes });
  return next;
}

// ── daily quests ─────────────────────────────────────────────────────────────────────────────────────────────
function sample<T>(list: T[], k: number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, k);
}

type QuestRow = typeof dailyQuests.$inferSelect;
const questView = (q: QuestRow, descriptions: Map<string, string>) => ({
  user_id: String(q.userId), quest_date_utc: q.day, quest_type: q.questType, target_count: q.targetCount, current_count: q.currentCount,
  reward_xp: q.rewardXp, reward_coins: q.rewardCoins, completed: q.completed, claimed: q.claimed,
  description: descriptions.get(q.questType) ?? q.questType,
});

/** Today's three quests (picked for the player's level the first time they're asked for today). */
export async function dailyQuestsFor(ctx: RequestContext, p: Player, progress?: Progress) {
  const prog = progress ?? await getProgress(ctx, p.id);
  const pool = dailyQuestPool(prog.currentLevel);
  const descriptions = new Map(pool.map((q) => [q.quest_type, q.description]));
  const today = localDate(p.tz);
  const read = () => ctx.db.select().from(dailyQuests).where(and(eq(dailyQuests.userId, p.id), eq(dailyQuests.day, today))).orderBy(dailyQuests.questType).all();
  let rows = await read();
  if (!rows.length) {
    const chosen = sample(pool, Math.min(3, pool.length));
    if (chosen.length) {
      await ctx.db.insert(dailyQuests).values(chosen.map((q) => ({
        userId: p.id, day: today, questType: q.quest_type, targetCount: q.target_count, rewardXp: q.reward_xp, rewardCoins: q.reward_coins,
      }))).onConflictDoNothing();
    }
    rows = await read();
  }
  return rows.map((q) => questView(q, descriptions));
}

export async function bumpQuest(ctx: RequestContext, p: Player, questType: string, amount = 1) {
  await ctx.db.update(dailyQuests).set({
    currentCount: sql`${dailyQuests.currentCount} + ${amount}`,
    completed: sql`CASE WHEN ${dailyQuests.currentCount} + ${amount} >= ${dailyQuests.targetCount} THEN 1 ELSE 0 END`,
  }).where(and(eq(dailyQuests.userId, p.id), eq(dailyQuests.day, localDate(p.tz)), eq(dailyQuests.questType, questType),
    eq(dailyQuests.claimed, 0), eq(dailyQuests.completed, 0)));
}

/** The quests an action moves on. */
export async function questsOnAction(ctx: RequestContext, p: Player, action: string, accuracy = 0) {
  const bump = (q: string) => bumpQuest(ctx, p, q);
  switch (action) {
    case "quiz_complete":
      await bump("complete_quizzes");
      if (accuracy >= 1) { await bump("perfect_quiz"); await bump("quiz_perfectionist"); }
      if (accuracy >= 0.9) await bump("quiz_master");
      break;
    case "arena_round_complete": await bump("arena_rounds"); break;
    case "boss_defeat": await bump("defeat_boss"); await bump("boss_hunter"); break;
    case "notes_generation": await bump("generate_notes"); await bump("notes_scholar"); break;
    case "flashcard_complete": await bump("study_flashcards"); break;
    case "review_card": await bump("review_cards"); break;
    case "review_complete": await bump("clear_reviews"); break;
    case "exam_complete": await bump("complete_exams"); break;
    case "chat_question": await bump("ask_questions"); break;
  }
  // the quest board's weekly trials count the same actions (scrolls.ts)
  if (SCROLL_ACTIONS.has(action)) await scrollEvent(ctx, p.id, [action]);
}
const SCROLL_ACTIONS = new Set(["quiz_complete", "boss_defeat", "notes_generation", "flashcard_complete", "review_card", "exam_complete"]);

/** Being active today (the "keep your streak" quest), with today's quests made first. */
export async function markActive(ctx: RequestContext, p: Player, progress?: Progress) {
  await dailyQuestsFor(ctx, p, progress);
  await bumpQuest(ctx, p, "maintain_streak");
}

// ── achievements ─────────────────────────────────────────────────────────────────────────────────────────────
function statValue(p: Progress, type: string, extra: Record<string, number> = {}): number {
  if (type in extra) return extra[type];
  switch (type) {
    case "total_quizzes_completed": return p.totalQuizzesCompleted;
    case "streak_days": return p.streakDays;
    case "total_bosses_defeated": return p.totalBossesDefeated;
    case "current_level": return p.currentLevel;
    case "best_quiz_accuracy": return p.bestQuizAccuracy;
    case "nightmare_bosses_defeated": return p.nightmareBossesDefeated;
    default: return 0;
  }
}

/** Unlock what the player has earned (rewards can level them up into more, so it checks again, a few times). */
export async function checkAchievements(ctx: RequestContext, userId: number) {
  const newly: { id: string; name: string; description: string; tier: string; reward_xp: number; reward_coins: number; reward_cosmetic_id: string | null }[] = [];
  for (let pass = 0; pass < 5; pass++) {
    const p = await getProgress(ctx, userId);
    const have = new Set((await ctx.db.select({ id: userAchievements.achievementId }).from(userAchievements).where(eq(userAchievements.userId, userId)).all()).map((r) => r.id));
    // Bestiary achievements count banes found alone and creatures beaten (read only when one is still open)
    const extra = ACHIEVEMENTS.some((a: AchievementDef) => !have.has(a.id) && a.unlock_type.startsWith("bestiary_")) ? await bestiaryStats(ctx, userId) : {};
    const due = ACHIEVEMENTS.filter((a: AchievementDef) => !have.has(a.id) && statValue(p, a.unlock_type, extra) >= a.threshold);
    if (!due.length) break;
    const cosmetics: string[] = [];
    for (const a of due) {
      const won = await ctx.db.insert(userAchievements).values({ userId, achievementId: a.id, unlockedAt: nowIso() }).onConflictDoNothing().returning({ id: userAchievements.achievementId }).all();
      if (!won.length) continue;
      await recordRewardEvent(ctx, userId, "achievement", a.reward_xp ?? 0, a.reward_coins ?? 0, a.id, `u${userId}:achievement:${a.id}`);
      if (a.reward_cosmetic_id) cosmetics.push(a.reward_cosmetic_id);
      newly.push({ id: a.id, name: a.name, description: a.description, tier: a.tier ?? "common", reward_xp: a.reward_xp ?? 0,
                   reward_coins: a.reward_coins ?? 0, reward_cosmetic_id: a.reward_cosmetic_id ?? null });
    }
    if (cosmetics.length) await modifyAvatar(ctx, userId, (_e, owned) => { for (const c of cosmetics) if (!owned.includes(c)) owned.push(c); });
  }
  return newly;
}

// ── buffs (potions) ──────────────────────────────────────────────────────────────────────────────────────────
type Buff = { effect: string; count?: number; expires_at: number; applied_at?: string; expires_iso?: string; duration_seconds?: number };
export const BUFF_DURATION: Record<string, number> = { xp_boost_1h: 3600, xp_boost_2h: 7200, coin_boost_1h: 3600 };
const ARENA_MAX: Record<string, number> = { heal_1: 3, fifty_fifty: 2 };
const ARENA_EXPIRY_DAYS = 30;

export async function activeBuffs(ctx: RequestContext, userId: number): Promise<Record<string, Buff>> {
  const row = await ctx.db.select().from(userBuffs).where(eq(userBuffs.userId, userId)).get();
  if (!row) return {};
  let all: Record<string, Buff> = {};
  try { all = JSON.parse(row.buffsJson || "{}"); } catch { return {}; }
  const now = Date.now() / 1000;
  const live = Object.fromEntries(Object.entries(all).filter(([, b]) => (b?.expires_at ?? 0) > now));
  if (Object.keys(live).length !== Object.keys(all).length) await saveBuffs(ctx, userId, live);
  return live;
}

export async function saveBuffs(ctx: RequestContext, userId: number, buffs: Record<string, Buff>) {
  const t = nowIso();
  await ctx.db.insert(userBuffs).values({ userId, buffsJson: JSON.stringify(buffs), updatedAt: t })
    .onConflictDoUpdate({ target: userBuffs.userId, set: { buffsJson: JSON.stringify(buffs), updatedAt: t } });
}

export async function xpMultiplier(ctx: RequestContext, userId: number) {
  const b = await activeBuffs(ctx, userId);
  return "xp_boost_2h" in b ? 2 : "xp_boost_1h" in b ? 1.5 : 1;
}
export async function coinMultiplier(ctx: RequestContext, userId: number) {
  return "coin_boost_1h" in (await activeBuffs(ctx, userId)) ? 1.5 : 1;
}

/** Use up one arena charge (heal_1, fifty_fifty, hint_charges). The count left, or -1 if there was none. */
export async function consumeCharge(ctx: RequestContext, userId: number, key: "heal_1" | "fifty_fifty" | "hint_charges"): Promise<number> {
  const buffs = await activeBuffs(ctx, userId);
  const n = Number(buffs[key]?.count ?? 0);
  if (n <= 0) { if (buffs[key]) { delete buffs[key]; await saveBuffs(ctx, userId, buffs); } return -1; }
  if (n <= 1) delete buffs[key]; else buffs[key] = { ...buffs[key], count: n - 1 };
  await saveBuffs(ctx, userId, buffs);
  return n - 1;
}

export async function applyBuff(ctx: RequestContext, p: Player, effect: string): Promise<{ ok: boolean; reason?: string; [k: string]: unknown }> {
  const buffs = await activeBuffs(ctx, p.id);
  const arenaExpiry = Date.now() / 1000 + ARENA_EXPIRY_DAYS * 86_400;
  if (effect === "heal_1" || effect === "fifty_fifty") {
    const cur = Number(buffs[effect]?.count ?? 0);
    if (cur >= ARENA_MAX[effect]) {
      return { ok: false, reason: effect === "heal_1" ? `Max ${ARENA_MAX.heal_1} heals already queued for arena` : `Max ${ARENA_MAX.fifty_fifty} Veil charges already queued for arena` };
    }
    buffs[effect] = { effect, count: cur + 1, expires_at: arenaExpiry, applied_at: nowIso() };
    await saveBuffs(ctx, p.id, buffs);
    const total = cur + 1;
    return effect === "heal_1"
      ? { ok: true, effect, count: total, message: `Crimson Vial ready! You have ${total} heal${total > 1 ? "s" : ""} for the Arena.` }
      : { ok: true, effect, count: total, message: `Veil of Duality ready! You have ${total} charge(s) for the Arena.` };
  }
  if (effect === "hint_charge") {
    const cur = Number(buffs.hint_charges?.count ?? 0);
    buffs.hint_charges = { effect, count: cur + 1, expires_at: arenaExpiry, applied_at: nowIso() };
    await saveBuffs(ctx, p.id, buffs);
    return { ok: true, effect, count: cur + 1, message: `Hint ready! You now have ${cur + 1} hint(s) for the Arena.` };
  }
  if (effect in BUFF_DURATION) {
    if (buffs[effect]) {
      const remaining = Math.trunc(buffs[effect].expires_at - Date.now() / 1000);
      return { ok: false, reason: `Buff already active (${remaining}s remaining)`, remaining_seconds: remaining };
    }
    const expires = new Date(Date.now() + BUFF_DURATION[effect] * 1000);
    buffs[effect] = { effect, expires_at: expires.getTime() / 1000, expires_iso: expires.toISOString(), applied_at: nowIso(), duration_seconds: BUFF_DURATION[effect] };
    await saveBuffs(ctx, p.id, buffs);
    const label = effect === "xp_boost_2h" ? "+100% XP for 2 hours!" : effect === "xp_boost_1h" ? "+50% XP for 1 hour!" : "+50% Coins for 1 hour!";
    return { ok: true, effect, message: label, expires_at: expires.toISOString() };
  }
  if (effect === "streak_freeze") {
    const prog = await getProgress(ctx, p.id);
    await setProgress(ctx, p.id, { streakFreezes: prog.streakFreezes + 1 });
    return { ok: true, effect, message: `Streak Shield activated! You now have ${prog.streakFreezes + 1} streak freeze(s).` };
  }
  if (effect === "reset_daily_quests") {
    await ctx.db.delete(dailyQuests).where(and(eq(dailyQuests.userId, p.id), eq(dailyQuests.day, localDate(p.tz))));
    return { ok: true, effect, message: "Daily quests reset! Refresh to get a new set." };
  }
  return { ok: false, reason: `Unknown effect: ${effect}` };
}

// ── equipment bonuses ────────────────────────────────────────────────────────────────────────────────────────
/** The passive bonuses of what the player wears (owned items only). */
export async function equipmentBonuses(ctx: RequestContext, userId: number) {
  const a = await getAvatar(ctx, userId);
  const totals: { xp_pct: number; coin_pct: number; combo_xp_pct: number; arena_hints: number; streak_freeze_days?: number } =
    { xp_pct: 0, coin_pct: 0, combo_xp_pct: 0, arena_hints: 0 };
  let freeze: number | undefined;
  for (const id of Object.values(a.equipped)) {
    if (typeof id !== "string" || !canUseItem(id, a.owned)) continue;
    const b: ItemBonus = ITEMS.get(id)?.bonus ?? {};
    totals.xp_pct += b.xp_pct ?? 0;
    totals.coin_pct += b.coin_pct ?? 0;
    totals.combo_xp_pct += b.combo_xp_pct ?? 0;
    totals.arena_hints += b.arena_hints ?? 0;
    if (b.streak_freeze_days !== undefined) freeze = freeze === undefined ? b.streak_freeze_days : Math.min(freeze, b.streak_freeze_days);
  }
  if (freeze !== undefined) totals.streak_freeze_days = freeze;
  return totals;
}

// ── rewards ──────────────────────────────────────────────────────────────────────────────────────────────────
export const tierMultiplier = (level: number) =>
  1 + REWARDS.tier_multiplier.bonus_per_tier * Math.floor((level - 1) / REWARDS.tier_multiplier.levels_per_tier);
const r2 = (x: number) => Math.round(x * 100) / 100;

export function calculateRewards(action: RewardAction, level: number, accuracy = 1, difficulty = 1, streakDays = 0, combo = 1) {
  const { xp: baseXp, coins: baseCoins } = REWARDS.actions[action];
  const base = tierMultiplier(level);
  const acc = 0.5 + clamp(accuracy, 0, 1);
  const diff = clamp(difficulty, 0.8, 2);
  const streak = 1 + Math.min(0.5, Math.max(0, streakDays) * 0.05);
  const comboMult = action === "arena_round_complete" || action === "boss_defeat" ? Math.min(2, 1 + Math.max(0, combo - 1) * 0.1) : 1;
  return {
    xp: Math.trunc(baseXp * base * acc * diff * streak * comboMult),
    coins: Math.trunc(baseCoins * base * acc * diff * streak),
    breakdown: { base: { xp: baseXp, coins: baseCoins }, tier_mult: r2(base), accuracy_mult: r2(acc), difficulty_mult: r2(diff),
                 streak_mult: r2(streak), combo_mult: comboMult > 1 ? r2(comboMult) : null } as Record<string, unknown>,
  };
}

async function totalsView(ctx: RequestContext, userId: number) {
  const p = await getProgress(ctx, userId);
  const [, into, toNext] = xpProgress(p.totalXp);
  return { total_xp: p.totalXp, coins: p.coins, level: p.currentLevel, xp_into_level: into, xp_to_next: toNext };
}

const COUNTERS: Partial<Record<RewardAction, Parameters<typeof incrementProgress>[2]>> = {
  arena_round_complete: "totalArenaRounds", boss_defeat: "totalBossesDefeated", quiz_complete: "totalQuizzesCompleted",
  chat_bundle_5: "totalChatBundles", notes_generation: "totalNotesGenerated", flashcard_complete: "totalFlashcardsStudied",
};

/**
 * Reward a finished activity, once. `sourceId` names it (a quiz id, `exam:<id>`): its ledger key is built from it,
 * so the same thing can't be paid twice; without one, the key is the day's cap slot. Daily caps are per local day.
 */
export async function award(ctx: RequestContext, p: Player, action: RewardAction, opts: { accuracy?: number; difficulty?: number; combo?: number; sourceId?: string } = {}) {
  if (!(REWARD_ACTIONS as readonly string[]).includes(action)) throw new Error(`Unknown action_type: ${action}`);
  const accuracy = clamp(num(opts.accuracy, 1), 0, 1);
  const difficulty = clamp(num(opts.difficulty, 1), 0, 3);
  const combo = Math.trunc(clamp(num(opts.combo, 1), 1, 100));
  const progress = await getProgress(ctx, p.id);
  const streakDays = await updateStreak(ctx, p);
  await markActive(ctx, p, progress);
  const day = localDate(p.tz);
  const capped = { ok: false, capped: true, reason: "Daily cap reached", action_type: action, xp_gained: 0, coins_gained: 0 };
  const slot = await takeDailySlot(ctx, p.id, day, action, REWARDS.actions[action].daily_cap || undefined);
  if (slot === null) return capped;
  const oldLevel = progress.currentLevel;
  let { xp, coins, breakdown } = calculateRewards(action, oldLevel, accuracy, difficulty, streakDays, combo);
  const xm = await xpMultiplier(ctx, p.id), cm = await coinMultiplier(ctx, p.id);
  if (xm !== 1) { xp = Math.trunc(xp * xm); breakdown.xp_buff_mult = xm; }
  if (cm !== 1) { coins = Math.trunc(coins * cm); breakdown.coin_buff_mult = cm; }
  const eq = await equipmentBonuses(ctx, p.id);
  if (eq.xp_pct > 0) { xp = Math.trunc(xp * (1 + eq.xp_pct)); breakdown.xp_equip_pct = eq.xp_pct; }
  if (eq.coin_pct > 0) { coins = Math.trunc(coins * (1 + eq.coin_pct)); breakdown.coin_equip_pct = eq.coin_pct; }
  if (eq.combo_xp_pct > 0 && combo >= 3) { const bonus = Math.trunc(xp * eq.combo_xp_pct); xp += bonus; breakdown.xp_combo_equip_bonus = bonus; }
  const source = opts.sourceId ?? `${day}:${slot}`;
  const t = await recordRewardEvent(ctx, p.id, action, xp, coins, source, `u${p.id}:award:${action}:${source}`);
  if (!t.applied) return capped;
  const counter = COUNTERS[action];
  if (counter) await incrementProgress(ctx, p.id, counter);
  // two worlds, Stage 5: studying fills Insight (an edge in your next fight)
  await addInsight(ctx, p.id, action);
  // your hero grows from everything you do: a share of every payout's XP (build.ts)
  if (xp > 0) {
    const boost = await heroXpBoost(ctx, p.id, action === "review_complete");
    await addHeroXp(ctx, p.id, xp * HERO_STUDY_SHARE * boost);
  }
  if (action === "quiz_complete") {
    const pct = Math.round(accuracy * 100);
    if (pct > progress.bestQuizAccuracy) await setProgress(ctx, p.id, { bestQuizAccuracy: pct });
  }
  if (action === "boss_defeat" && difficulty >= 2.5) await incrementProgress(ctx, p.id, "nightmareBossesDefeated");
  let levelUp: { from: number; to: number; bonus_coins: number; shop_unlocked: boolean } | null = null;
  if (t.level > oldLevel) {
    const bonus = REWARDS.level_up_bonus_coins_per_level * t.level;
    await recordRewardEvent(ctx, p.id, "level_up_bonus", 0, bonus, String(t.level), `u${p.id}:level_up:${t.level}`);
    levelUp = { from: oldLevel, to: t.level, bonus_coins: bonus, shop_unlocked: oldLevel < 5 && 5 <= t.level };
  }
  await questsOnAction(ctx, p, action, accuracy);
  const newly = await checkAchievements(ctx, p.id);
  return { ok: true, action_type: action, xp_gained: xp, coins_gained: coins, breakdown, streak_days: streakDays, level_up: levelUp,
           totals: await totalsView(ctx, p.id), new_achievements: newly };
}

/** A one-off bonus (a daily-quest claim) as ONE ledger event; the same key never pays twice. */
export async function applyBonus(ctx: RequestContext, userId: number, xp: number, coins: number, source: string, key: string, kind = "bonus", sourceId?: string) {
  const old = (await getProgress(ctx, userId)).currentLevel;
  const t = await recordRewardEvent(ctx, userId, kind, xp, coins, sourceId ?? source, key);
  if (!t.applied) return { ok: false as const, reason: "Already claimed" };
  const newly = await checkAchievements(ctx, userId);
  const totals = await totalsView(ctx, userId);
  return { source, xp_gained: xp, coins_gained: coins, totals, level_up: totals.level > old ? { from: old, to: totals.level } : null, new_achievements: newly };
}

export async function claimQuest(ctx: RequestContext, p: Player, questType: string) {
  const today = localDate(p.tz);
  const q = await ctx.db.select().from(dailyQuests).where(and(eq(dailyQuests.userId, p.id), eq(dailyQuests.day, today), eq(dailyQuests.questType, String(questType)))).get();
  if (!q) return { ok: false, reason: "Quest not found" };
  if (q.claimed === 1) return { ok: false, reason: "Already claimed" };
  if (q.completed !== 1) return { ok: false, reason: "Quest not completed" };
  const won = await ctx.db.update(dailyQuests).set({ claimed: 1 })
    .where(and(eq(dailyQuests.userId, p.id), eq(dailyQuests.day, today), eq(dailyQuests.questType, q.questType), eq(dailyQuests.completed, 1), eq(dailyQuests.claimed, 0)))
    .returning({ t: dailyQuests.questType }).all();
  if (!won.length) return { ok: false, reason: "Already claimed" };
  const bonus = await applyBonus(ctx, p.id, q.rewardXp, q.rewardCoins, `daily_quest:${q.questType}`, `u${p.id}:quest:${today}:${q.questType}`, "quest_claim", q.questType);
  if ("ok" in bonus && bonus.ok === false) return bonus;
  return { ok: true, ...bonus };
}
