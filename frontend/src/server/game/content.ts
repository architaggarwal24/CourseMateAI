// Static game data (Stage 4.5; was backend/content/*.json + game_content.py): shop items, quests, achievements,
// levels, reward tables and relics. Changing the numbers or texts in content/*.json changes the game. content.test.ts
// checks the files the way game_content.py did (unknown types, duplicate ids, effects the code doesn't know).
import achievementsFile from "./content/achievements.json";
import levelsFile from "./content/levels.json";
import questsFile from "./content/quests.json";
import relicsFile from "./content/relics.json";
import rewardsFile from "./content/rewards.json";
import shopFile from "./content/shop.json";

export const ITEM_TYPES = ["armor", "headgear", "weapon", "pet", "potion", "title"] as const;
export const KNOWN_EFFECTS = ["heal_1", "hint_charge", "fifty_fifty", "xp_boost_1h", "xp_boost_2h", "coin_boost_1h", "streak_freeze", "reset_daily_quests"];
export const KNOWN_UNLOCK_TYPES = ["total_quizzes_completed", "streak_days", "total_bosses_defeated", "current_level", "best_quiz_accuracy", "nightmare_bosses_defeated"];
export const REWARD_ACTIONS = ["arena_round_complete", "boss_defeat", "quiz_complete", "chat_bundle_5", "notes_generation", "flashcard_complete",
  "expedition_complete", "review_complete", "exam_complete"] as const;
export type RewardAction = (typeof REWARD_ACTIONS)[number];

export interface ItemBonus { xp_pct?: number; coin_pct?: number; combo_xp_pct?: number; arena_hints?: number; streak_freeze_days?: number }
export interface ItemBattle { damage_pct?: number; hp?: number; time_sec?: number; strike?: number }
interface RawItem {
  id: string; type: string; name: string; description: string; price: number; sprite: string; level_required?: number;
  bonus?: ItemBonus; battle?: ItemBattle; consumable?: boolean; effect?: string; arena_only?: boolean; rarity?: string;
  mastery?: { champion: string; level: number };
}
export interface CatalogItem extends Omit<RawItem, "effect"> {
  tier: string; level_required: number; category: string; consumable: boolean; effect: string | null; bonus: ItemBonus; battle: ItemBattle;
}

export const shop = shopFile as unknown as {
  categories: { id: string; unlock_level: number; name: string; icon: string; description: string }[];
  tiers: { id: string; category: string; unlocks_at_level: number; items: RawItem[] }[];
};

/** Every shop item, flat, sorted by category then price (the API's shape). */
export const CATALOG: CatalogItem[] = shop.tiers.flatMap((tier) => tier.items.map((it) => ({
  ...it, tier: tier.id, level_required: Math.max(it.level_required ?? tier.unlocks_at_level, tier.unlocks_at_level), category: tier.category,
  consumable: it.consumable ?? false, effect: it.effect ?? null, bonus: it.bonus ?? {}, battle: it.battle ?? {},
}))).map((it, i) => ({ it, i })).sort((a, b) => (a.it.category < b.it.category ? -1 : a.it.category > b.it.category ? 1 : a.it.price - b.it.price || a.i - b.i)).map((x) => x.it);
export const ITEMS = new Map(CATALOG.map((it) => [it.id, it]));
export const CATEGORY_UNLOCK_LEVELS: Record<string, number> = Object.fromEntries(shop.categories.map((c) => [c.id, c.unlock_level]));
export const CATEGORY_INFO: Record<string, { name: string; icon: string; description: string }> =
  Object.fromEntries(shop.categories.map((c) => [c.id, { name: c.name, icon: c.icon, description: c.description }]));

// ── levels ───────────────────────────────────────────────────────────────────────────────────────────────────
const XP_TO_NEXT: number[] = levelsFile.xp_to_next_level;
export const xpToNextLevel = (level: number) => XP_TO_NEXT[Math.min(Math.max(level, 1), XP_TO_NEXT.length) - 1];
const THRESHOLDS: number[] = [];
for (let lvl = 1, cursor = 0; lvl <= XP_TO_NEXT.length; lvl++) { THRESHOLDS.push(cursor); cursor += xpToNextLevel(lvl); }
export function levelFromTotalXp(totalXp: number): number {
  let lvl = 1;
  for (let i = 0; i < THRESHOLDS.length; i++) if (THRESHOLDS[i] <= totalXp) lvl = i + 1;
  return lvl;
}
export function xpProgress(totalXp: number): [level: number, intoLevel: number, toNext: number] {
  const lvl = levelFromTotalXp(totalXp);
  return [lvl, totalXp - THRESHOLDS[lvl - 1], xpToNextLevel(lvl)];
}

// ── rewards ──────────────────────────────────────────────────────────────────────────────────────────────────
export const rewards = rewardsFile as {
  actions: Record<RewardAction, { xp: number; coins: number; daily_cap: number }>;
  tier_multiplier: { levels_per_tier: number; bonus_per_tier: number };
  level_up_bonus_coins_per_level: number;
};

// ── quests ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface QuestDef { quest_type: string; description: string; target_count: number; reward_xp: number; reward_coins: number; level_required: number; icon?: string }
export const quests = questsFile as unknown as { groups: { kind: "daily" | "weekly" | "special"; min_level: number; quests: QuestDef[] }[] };

/** The daily quests a player of this level can get. */
export function dailyQuestPool(level: number): QuestDef[] {
  return quests.groups.filter((g) => g.kind === "daily" && level >= g.min_level).flatMap((g) => g.quests).filter((q) => q.level_required <= level);
}

// ── achievements ─────────────────────────────────────────────────────────────────────────────────────────────
export interface AchievementDef { id: string; name: string; description: string; unlock_type: string; threshold: number; reward_xp: number; reward_coins: number; reward_cosmetic_id?: string | null; tier?: string }
export const ACHIEVEMENTS = (achievementsFile as unknown as { achievements: AchievementDef[] }).achievements;
/** The row shape the API has always served (the old `achievements` table's columns). */
export const achievementRow = (a: AchievementDef) => ({
  achievement_id: a.id, name: a.name, description: a.description, unlock_type: a.unlock_type, unlock_threshold: a.threshold,
  reward_xp: a.reward_xp ?? 0, reward_coins: a.reward_coins ?? 0, reward_cosmetic_id: a.reward_cosmetic_id ?? null, tier: a.tier ?? "common",
});

// ── relics (expeditions) ─────────────────────────────────────────────────────────────────────────────────────
export const relics = relicsFile as unknown as { relics: { id: string; name: string; text: string; price: number; weight: number; [k: string]: unknown }[] };

// ── champions ────────────────────────────────────────────────────────────────────────────────────────────────
export const CHAMPIONS = ["kaien", "asha", "brak", "mira", "vex", "thorne"] as const;
export type Champion = (typeof CHAMPIONS)[number];
export const DEFAULT_CHAMPION: Champion = "kaien";
export const LOADOUT_SLOTS = ["armor", "headgear", "weapon", "pet"] as const;
export const isChampion = (v: unknown): v is Champion => typeof v === "string" && (CHAMPIONS as readonly string[]).includes(v);
