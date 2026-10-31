// The arena's wire types. The OpenAPI schema types the battle endpoints loosely ({[key: string]: unknown}), so the
// shapes the server really sends (backend/services/arena_service.py) are written down here, once.

export const DIFFICULTIES = ["easy", "medium", "hard", "nightmare"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard", nightmare: "Nightmare" };
/** One line per difficulty. (The server sets the numbers: boss health and how hard it hits.) */
export const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  easy: "A warm-up challenge with a gentle boss.",
  medium: "A real test. Think before you answer.",
  hard: "No mercy. The boss hits hard.",
  nightmare: "The toughest boss there is. Good luck.",
};

export type BattleStatus = "active" | "won" | "lost";
export type BattleMode = "quick" | "nemesis" | "expedition";

// ── Arena v2: moves, Focus, spells, boss intents (docs/arena-v2.md) ──────────────────────────────────────────────
export const MOVES = ["strike", "jab", "heavy", "guard"] as const;
export type Move = (typeof MOVES)[number];
export const MOVE_INFO: Record<Move, { label: string; tier: string; blurb: string; key: string }> = {
  strike: { label: "Strike", tier: "Medium question", blurb: "Full damage.", key: "Q" },
  jab: { label: "Jab", tier: "Easy question", blurb: "60% damage, 15s clock, +1 extra Focus.", key: "W" },
  heavy: { label: "Heavy", tier: "Hard question", blurb: "180% damage. Costs Focus.", key: "E" },
  guard: { label: "Guard", tier: "Medium question", blurb: "No damage. Right answer blocks the boss's attack.", key: "R" },
};
export type Spell = "insight" | "timewarp";
export type IntentKind = "attack" | "heavy" | "shield" | "drain" | "heal";
/** What the boss will do when this turn resolves (telegraphed before the player picks a move). */
export interface Intent { kind: IntentKind; name: string; value: number; description: string; amount?: number }

export interface Relic { id: string; name: string; description: string; rarity: "common" | "rare" | "epic" | "legendary" }
export interface MissedConcept { concept: string; question: string; correct_answer: string; explanation?: string | null }
export type ItemId = "heal" | "fifty_fifty";
export interface Stock { heal: number; fifty_fifty: number }

/** What the server tells us about the boss. Never anything that would give an answer away. */
export interface BossProfile {
  name: string;
  /** The bestiary creature the boss is (drawn by lib/pixel): hydra, minotaur, ... ammit. */
  species?: string;
  /** The myth it comes from: Greek, Norse, Indian, Japanese, Egyptian, Persian. */
  origin?: string;
  title?: string;
  /** Nemesis bosses: the concepts they are built from. */
  target_concepts?: string[];
  tagline?: string;
  personality?: string;
  special_ability?: string;
  weakness?: string;
  intro_taunt?: string;
}

/** An award result as the reward service reports it (only the fields the result screen shows). */
export interface AwardResult { ok?: boolean; xp?: number; coins?: number; [key: string]: unknown }
export interface BattleRewards { arena_round_complete: AwardResult | null; boss_defeat: AwardResult | null }

export interface BattleResult {
  grade: string; accuracy: number; time_seconds: number; new_personal_best: boolean;
  /** The questions answered wrong (loot: they become review cards). */
  missed?: MissedConcept[];
  /** For a battle inside an expedition: what it did to the run. */
  run?: { status?: string; pending?: string; gained_gold?: number; [key: string]: unknown };
}

/** What the hero's gear adds to a fight (snapshot taken when the battle began; see backend/services/arena_service.py). */
export interface Gear {
  items: Partial<Record<"weapon" | "armor" | "headgear" | "pet", string>>;
  damage_pct: number;
  hp: number;
  time_sec: number;
  strike: number;
}

export interface Battle {
  battle_id: string;
  status: BattleStatus;
  session_id: string;
  topic: string;
  difficulty: Difficulty;
  phase: number;
  rage: boolean;
  boss: { name: string; hp: number; max_hp: number; species?: string | null; title?: string | null; origin?: string | null };
  player: { hp: number; max_hp: number };
  combo: number;
  max_combo: number;
  answered: number;
  correct: number;
  heals_used: number;
  fifty_used: number;
  gear?: Gear;
  mode?: BattleMode;
  run_id?: string | null;
  focus?: number;
  focus_cap?: number;
  shield?: number;
  /** The boss's telegraphed move for the coming turn (null once the battle is over). */
  intent?: Intent | null;
  relics?: string[];
  heavy_cost?: number;
  free_timewarp?: boolean;
  /** A question is out (its clock running): a resumed screen goes straight back to it. */
  question_issued?: boolean;
  /** Only once the battle is over. */
  result?: Partial<BattleResult>;
  rewards?: BattleRewards | null;
}

export interface Question {
  /** The server's id for this question: sent back with the answer. */
  id: number;
  number: number;
  question: string;
  /** Already shuffled by the server; options removed by a 50/50 are not here. */
  options: string[];
  concept?: string | null;
  difficulty?: string | null;
  phase: number;
  weakness: boolean;
  fifty_used: boolean;
  move?: Move;
  tier?: string;
  timewarped?: boolean;
  time_limit: number;
  expires_at: string;
  seconds_left: number;
}

/** How one question ended: the answer response, and the `previous` of a question that timed out while we were away. */
export interface Outcome {
  question_id: number;
  correct: boolean;
  timed_out: boolean;
  answer: string | null;
  correct_answer: string;
  explanation?: string | null;
  damage_dealt: number;
  hit_type?: string | null;
  weakness?: boolean;
  damage_taken: number;
  attack_name?: string | null;
  taunt?: string | null;
  phase_changed?: boolean;
  combo: number;
  /** Extra damage the weapon added, and the pet's flat strike (both already inside damage_dealt). */
  gear_bonus?: number;
  pet_strike?: number;
  move?: Move;
  tier?: string;
  /** The intent that just resolved, and the one telegraphed for the next turn. */
  intent?: Intent | null;
  next_intent?: Intent | null;
  blocked?: boolean;
  interrupted?: boolean;
  shield_absorbed?: number;
  boss_healed?: number;
  focus?: number;
  focus_gained?: number;
  focus_drained?: boolean | number;
  aegis?: boolean;
  revived?: boolean;
  lifesteal?: number;
}

export interface AnswerResponse extends Outcome { ok: boolean; replayed: boolean; battle: Battle; rewards: BattleRewards | null }
export interface QuestionResponse { ok: boolean; battle: Battle; question: Question | null; previous: Outcome | null; stock?: Stock }
export interface ItemResponse { ok: boolean; item: ItemId; battle: Battle; question: Question | null; stock: Stock }
export interface ForfeitResponse { ok: boolean; battle: Battle; rewards: BattleRewards | null }
export interface SpellResponse { ok: boolean; spell: Spell; cost: number; battle: Battle; question: Question | null }
export interface CreateResponse { ok: boolean; battle_id: string; resumed: boolean; boss: BossProfile; battle: Battle }
export interface BattleGetResponse { ok: boolean; battle_id: string; boss: BossProfile; battle: Battle }
/** The battle in progress, with the boss as it should be drawn (so a refresh can rebuild the whole screen). */
export interface ActiveBattle extends Battle { boss_profile: BossProfile }

export interface LeaderboardResponse { ok: boolean; entries: LeaderboardEntry[]; total: number }
export interface LeaderboardEntry {
  rank: number; username: string; grade: string; accuracy: number; time: number; date?: string; is_me: boolean; topic?: string;
}

// ── Concept mastery ──────────────────────────────────────────────────────────────────────────────────────────
export interface WeakConcept { concept: string; seen: number; correct: number; misses: number; wrong_streak: number; last_wrong_at?: string | null; score: number }
export interface WeakConceptsResponse { concepts: WeakConcept[]; missed_total: number; nemesis_ready: boolean }

// ── Expedition (roguelite run) ───────────────────────────────────────────────────────────────────────────────
export type NodeKind = "battle" | "elite" | "nemesis" | "rest" | "shop" | "treasure" | "boss";
export interface RunNode { id: string; layer: number; index: number; kind: NodeKind; edges: string[] }
export interface RunMap { act: number; nodes: RunNode[]; boss: string }
export interface ShopStockItem { id: string; kind: "relic" | "potion"; name: string; description: string; price: number; sold: boolean; rarity?: Relic["rarity"] }
export type Pending =
  | { kind: "rest"; node_id: string; heal: number; concepts: string[]; options: ("heal" | "study")[] }
  | { kind: "shop"; node_id: string; stock: ShopStockItem[] }
  | { kind: "relic"; node_id: string; options: string[]; relics: Relic[]; then?: "next_act" | null };
export type RunStatus = "active" | "won" | "lost" | "abandoned";
export interface Run {
  run_id: string; status: RunStatus; session_id: string; difficulty: Difficulty;
  act: number; acts_total: number; acts: { title: string; topic: string }[]; act_title: string;
  map: RunMap; node_id: string | null; visited: string[]; reachable: string[];
  hearts: number; max_hearts: number; gold: number; relics: Relic[];
  focus_cap: number; act_focus_bonus: number; pending: Pending | null; battle_id: string | null;
  depth: number; battles_won: number; score: number; flags?: Record<string, unknown>;
  result?: Record<string, unknown>; rewards?: Record<string, AwardResult | null> | null;
}
export interface RunResponse { ok: boolean; resumed?: boolean; run: Run }
export interface TravelResponse { ok: boolean; run: Run; node: RunNode; battle_id?: string; boss?: BossProfile; battle?: Battle; gained?: Record<string, unknown> }
export interface ChooseResponse { ok: boolean; run: Run; outcome: Record<string, unknown> }
export interface RunBoardEntry { rank: number; username: string; score: number; depth: number; act: number; status: RunStatus; difficulty: Difficulty; date?: string; is_me: boolean }
