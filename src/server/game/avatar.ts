// The avatar (port of backend/routers/avatar.py): the player's pixel champion and the skins it wears, plus the
// profile, HUD and achievements views (routers/progression.py).
import { eq } from "drizzle-orm";
import type { RequestContext } from "../context";
import { championProgress, userAchievements } from "../db/schema";
import { HttpError } from "../http";
import { ACHIEVEMENTS, CHAMPIONS, DEFAULT_CHAMPION, LOADOUT_SLOTS, achievementRow, isChampion, xpProgress, type Champion } from "./content";
import { canEquipInSlot, EQUIP_SLOTS, masteryChampion } from "./items";
import { KITS, LEVEL_XP, masteryUnlocks, nextLevelXp } from "./kits";
import { activeBuffs, dailyQuestsFor } from "./progression";
import { SHOP_LEVEL, shopState } from "./shop";
import { getAvatar, getProgress, inventory, modifyAvatar, nowIso, progressView, type Avatar, type Player } from "./store";

const championOf = (a: Avatar): [Champion, boolean] =>
  [isChampion(a.championId) ? a.championId : DEFAULT_CHAMPION, !!a.championSetAt && isChampion(a.championId)];

/** Wear or remove items in place: only items that exist, fit the slot and are owned (or free). "" / "none" empties. */
function applySlots(equipped: Record<string, string>, owned: string[], slots: Record<string, unknown>, allowed: Set<string> = EQUIP_SLOTS, champion?: string) {
  for (const [slot, id] of Object.entries(slots)) {
    if (!allowed.has(slot)) continue;
    if (id === "" || id === "none" || id === null || id === undefined) delete equipped[slot];
    else if (typeof id === "string" && canEquipInSlot(id, slot, owned, champion)) equipped[slot] = id;
  }
}

export async function avatarView(ctx: RequestContext, userId: number) {
  const a = await getAvatar(ctx, userId);
  const [champion, chosen] = championOf(a);
  return { equipped: a.equipped, owned: a.owned, champion_id: champion, champion_chosen: chosen };
}

export async function updateAvatar(ctx: RequestContext, userId: number, slots: unknown) {
  const s = slots && typeof slots === "object" ? (slots as Record<string, unknown>) : {};
  const [champion] = championOf(await getAvatar(ctx, userId));
  const a = await modifyAvatar(ctx, userId, (eq, ow) => applySlots(eq, ow, s, EQUIP_SLOTS, champion));
  return { ok: true, equipped: a.equipped, owned: a.owned };
}

export async function championState(ctx: RequestContext, userId: number) {
  const a = await getAvatar(ctx, userId);
  const [champion, chosen] = championOf(a);
  const rows = new Map((await ctx.db.select().from(championProgress).where(eq(championProgress.userId, userId)).all()).map((r) => [r.championId, r]));
  const progress = Object.fromEntries(CHAMPIONS.map((cid) => {
    const r = rows.get(cid) ?? { xp: 0, level: 1, battles: 0, wins: 0 };
    return [cid, {
      xp: r.xp, level: r.level, next_level_xp: nextLevelXp(r.level), level_xp: LEVEL_XP[r.level - 1], battles: r.battles, wins: r.wins,
      mastery: masteryUnlocks(cid), kit: { passive: { name: KITS[cid].passive_name, text: KITS[cid].passive_text }, ultimate: { name: KITS[cid].ultimate_name, text: KITS[cid].ultimate_text } },
    }];
  }));
  const loadout = Object.fromEntries(LOADOUT_SLOTS.map((s) => [s, a.equipped[s] || null]));
  return { champion_id: champion, chosen, champions: [...CHAMPIONS], loadout, progress };
}

export async function chooseChampion(ctx: RequestContext, userId: number, body: Record<string, unknown>) {
  const cid = body.champion_id;
  if (!isChampion(cid)) throw new HttpError(422, "unknown_champion", "That champion doesn't exist.", null, { champions: [...CHAMPIONS] });
  const loadout = body.loadout && typeof body.loadout === "object" ? (body.loadout as Record<string, unknown>) : null;
  await modifyAvatar(ctx, userId, (eq, ow) => {
    for (const [slot, id] of Object.entries(eq)) { const owner = typeof id === "string" ? masteryChampion(id) : null; if (owner && owner !== cid) delete eq[slot]; }
    if (loadout) applySlots(eq, ow, loadout, new Set(LOADOUT_SLOTS), cid);
  }, { championId: cid, championSetAt: nowIso() });
  return championState(ctx, userId);
}

// ── profile, HUD, achievements ───────────────────────────────────────────────────────────────────────────────
const GUEST_PROGRESS = { current_level: 1, total_xp: 0, coins: 0, xp_into_level: 0, xp_to_next: 100 };

export async function profile(ctx: RequestContext, userId: number | null) {
  if (userId === null) return { progress: GUEST_PROGRESS, avatar: {}, guest_mode: true };
  const p = await getProgress(ctx, userId);
  const a = await getAvatar(ctx, userId);
  const [, into, toNext] = xpProgress(p.totalXp);
  return {
    progress: { ...progressView(p), xp_into_level: into, xp_to_next: toNext },
    avatar: { user_id: String(userId), equipped_json: JSON.stringify(a.equipped), owned_json: JSON.stringify(a.owned), champion_id: a.championId, champion_set_at: a.championSetAt },
    guest_mode: false,
  };
}

export async function hud(ctx: RequestContext, p: Player | null) {
  if (!p) {
    return { progress: { ...GUEST_PROGRESS, total_chat_questions: 0, total_quiz_questions: 0 }, quests: [],
             shop: { shop_unlocked: false, level: 1, coins: 0, items: [] }, guest_mode: true };
  }
  const prog = await getProgress(ctx, p.id);
  const [, into, toNext] = xpProgress(prog.totalXp);
  const quests = await dailyQuestsFor(ctx, p, prog);
  const shop = prog.currentLevel < SHOP_LEVEL
    ? { shop_unlocked: false, level: prog.currentLevel, coins: prog.coins, items: [] }
    : await shopState(ctx, p, prog);
  return {
    progress: { ...progressView(prog), xp_into_level: into, xp_to_next: toNext }, quests, shop,
    buffs: await activeBuffs(ctx, p.id), consumable_inventory: await inventory(ctx, p.id), guest_mode: false,
  };
}

export async function achievements(ctx: RequestContext, userId: number | null) {
  const all = ACHIEVEMENTS.map(achievementRow);
  if (userId === null) return { achievements: all, unlocked: {}, progress: {}, guest_mode: true };
  const rows = await ctx.db.select().from(userAchievements).where(eq(userAchievements.userId, userId)).all();
  const p = await getProgress(ctx, userId);
  return {
    achievements: all, unlocked: Object.fromEntries(rows.map((r) => [r.achievementId, r.unlockedAt])),
    progress: {
      total_quizzes_completed: p.totalQuizzesCompleted, streak_days: p.streakDays, total_bosses_defeated: p.totalBossesDefeated,
      current_level: p.currentLevel, best_quiz_accuracy: p.bestQuizAccuracy, nightmare_bosses_defeated: p.nightmareBossesDefeated,
    },
    guest_mode: false,
  };
}
