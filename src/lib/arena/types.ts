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

// ── Arena v2: moves, Focus, spells, boss intents ──────────────────────────────────────────────
export const MOVES = ["strike", "jab", "heavy", "guard"] as const;
export type Move = (typeof MOVES)[number];
export const MOVE_INFO: Record<Move, { label: string; tier: string; blurb: string; key: string }> = {
  strike: { label: "Strike", tier: "Medium question", blurb: "Full damage.", key: "Q" },
  jab: { label: "Jab", tier: "Easy question", blurb: "60% damage, 15s clock, +1 extra Focus.", key: "W" },
  heavy: { label: "Heavy", tier: "Hard question", blurb: "180% damage. Costs Focus.", key: "E" },
  guard: { label: "Guard", tier: "Medium question", blurb: "No damage. Right answer blocks the boss's attack.", key: "R" },
};
export type Spell = "insight" | "timewarp";
export type IntentKind =
  | "attack" | "heavy" | "shield" | "drain" | "heal"
  // a creature's signature turns (backend core_brains/mechanics.py)
  | "grab" | "riddle" | "illusion" | "charge" | "aim" | "throw" | "hoard" | "stunned"
  // Stage 3: the enraged creature's signature blow; Stage 4: on its knees, waiting for your FINAL MOVE
  | "fury" | "finale";
/** Intents that hit (their value is damage). */
export const DAMAGING_INTENTS: readonly IntentKind[] = ["attack", "heavy", "grab", "riddle", "illusion", "charge", "throw", "hoard", "fury"];

/** Stage 3: what a boss's blow does to your champion besides hearts (server effects.ts). */
export type EffectKind = "dot" | "clock" | "lock" | "silence" | "curse" | "weaken" | "blind" | "fog" | "shuffle" | "sap" | "drain";
/** An effect a blow carries (telegraphed with it; it lands on a miss). */
export interface IntentEffect { id: string; name: string; kind: EffectKind; text: string }
/** An effect on your champion now, and how many more questions it lasts (`boss`: the creature's own, enraged). */
export interface ActiveEffect { id: string; name: string; kind: EffectKind; turns: number; text: string; moves?: Move[]; boss?: boolean }

/** What the boss will do when this turn resolves (telegraphed before the player picks a move). */
export interface Intent {
  kind: IntentKind; name: string; value: number; description: string; amount?: number; special?: boolean;
  /** The effect it carries (lands on a miss). */
  effect?: IntentEffect;
  /** An enraged signature blow strikes this many times (the hydra: every head). */
  hits?: number;
}

/** The creature's signature mechanic as the HUD shows it: its rule in one line and its counters. */
export interface MechanicCounter { label: string; value?: number; max?: number; text?: string; hint?: string }
export interface MechanicHud { id: string; name: string; summary: string; counters: MechanicCounter[]; locked_moves: Move[] }
export interface MechanicEvent { type: string; text: string; [key: string]: unknown }
/** What the mechanic did on one answer. */
export interface MechanicOutcome {
  id: string; events: MechanicEvent[]; boss_healed: number; damage: number; hearts: number; focus: number; shield: number;
  illusion_picked: boolean; hud: MechanicHud | null;
}

/** The champion's kit in a fight (backend core_brains/kits.py): passive, ultimate and its meter. */
export interface KitHud {
  champion: string; meter: number; max: number; ready: boolean; active: boolean;
  passive: { name: string; text: string }; ultimate: { name: string; text: string };
  /** The champion's con (a wrong Heavy costs a heart, fewer hearts...). Missing from older servers. */
  weakness?: { name: string; text: string };
  effects: Partial<Record<"armed" | "wall" | "vanish" | "fortress", string | number>>;
  /** Fighting with the champion's own mastery weapon: its perk and the finisher that ends the fight. */
  signature?: { name: string; text: string; finisher: string } | null;
}
export interface KitOutcome { events: MechanicEvent[]; refund: number; hud: KitHud }
/** XP the champion earned in a finished battle (and the mastery skins a level-up unlocked). */
export interface ChampionXp {
  id: string; xp_gained: number; xp: number; level: number; leveled_up: boolean; next_level_xp: number | null; unlocked: string[];
}

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
  /** What it roars when it enrages (its creature's line comes first). */
  phase2_taunts?: string[];
  intro_taunt?: string;
}

/** An award result as the reward service reports it (only the fields the result screen shows). */
export interface AwardResult { ok?: boolean; xp?: number; coins?: number; [key: string]: unknown }
export interface BattleRewards { arena_round_complete: AwardResult | null; boss_defeat: AwardResult | null }

export interface BattleResult {
  grade: string; accuracy: number; time_seconds: number; new_personal_best: boolean;
  /** The questions answered wrong (loot: they become review cards). */
  missed?: MissedConcept[];
  /** The champion that fought: its XP, level and any mastery skin unlocked. */
  champion?: ChampionXp;
  /** For a battle inside an expedition: what it did to the run. */
  run?: { status?: string; pending?: string; gained_gold?: number; [key: string]: unknown };
  /** The Bestiary: this creature's record, a first defeat, mastery gained, a tier opened. */
  bestiary?: BestiaryFight | null;
  /** Champions this win brought (a Bestiary tier finished); the unlock ceremony follows. */
  champions_unlocked?: string[];
  /** Mastery challenges this fight finished, for the champion who fought it. */
  challenges_done?: string[];
  /** The forge: XP each worn item earned, and the materials a Bestiary win dropped. */
  forge?: { item_xp: number; items: string[]; materials: { id: string; name: string; count: number; rare: boolean }[] };
  /** The taunt's extra +25% of the win's reward. */
  taunt_bonus?: { xp: number; coins: number };
  /** Stage 4: the score card. */
  score?: ScoreCard;
  /** Stage 6: a Boss Rush / Survival fight: where the run stands now, a chest won, its end. */
  gauntlet?: GauntletStep | null;
  new_achievements?: { id: string; name: string; description: string }[];
}

/** The fight's score card: points (speed included), the finisher, hearts left, combo, continues (each keeps 75%). */
export interface ScoreCard {
  points: number; speed: number; finisher: number; hearts: number; best_combo: number; best_level: number; specials: number;
  continues: number; total: number; rank: string;
}
export interface ContinueResponse { ok: boolean; continued: { by: "potion" | "coins"; continues: number }; battle: Battle; stock: { heal: number; fifty_fifty: number } }

export type Mastery = "none" | "bronze" | "silver" | "gold";
export interface BestiaryFight {
  species: string; tier: number; won: boolean; first_win: boolean; flawless: boolean;
  mastery: Mastery; mastery_up: Mastery | null; tier_opened: number | null; tiers_finished?: number[]; rewards: { xp: number; coins: number };
}
/** A creature's bane in a fight: the combo once it is written in (after the first win), else only the clue. */
export interface BaneHud { known: boolean; clue: string; moves: Move[] | null; progress: number }
/** One page of the Bestiary (GET /bestiary). A locked page has no name, story or bane. */
export interface BestiaryEntry {
  species: string; tier: number; open: boolean; met: boolean; defeated: boolean;
  name: string | null; origin: string | null; teaser_topic: string | null; mastery: Mastery;
  record: { fights: number; wins: number; losses: number; flawless_wins: number; nightmare_wins: number; best_seconds: number | null;
    best_accuracy: number | null; first_win_at: string | null; last_fought_at: string | null } | null;
  bane: { clue: string; moves: Move[] | null; found_alone: boolean; uses: number } | null;
  /** The creature's lost page was found (a Hunt's reward). */
  lost_page?: boolean;
  /** An open page's stat block (round 7): its blows, its special, how much tougher its tier is (HP and time). */
  stats?: { attacks: string[]; special: string; hp_scale: number; time_scale: number } | null;
}
export interface BestiaryTier { tier: number; name: string; open: boolean; beaten: number; total: number; opens_next_at: number | null }
export interface BestiaryResponse { tiers: BestiaryTier[]; creatures: BestiaryEntry[] }
export interface BestiaryPage extends BestiaryEntry { concepts: { concept: string; asked: number; right: number }[] }

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
  /** The whole fight's questions are written (a fight is prepared before it starts). */
  prepared?: boolean;
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
  /** Stage 6: the Boss Rush / Survival this fight belongs to. */
  gauntlet_id?: string | null;
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
  /** The creature's signature mechanic (null for a boss without one). */
  mechanic?: MechanicHud | null;
  /** The champion's kit and ultimate meter. */
  kit?: KitHud | null;
  /** The creature's Bestiary tier (1-4) and its bane. */
  tier?: number;
  bane?: BaneHud | null;
  /** The boss was taunted this fight (once a fight: it rages, the win pays +25%). */
  taunted?: boolean;
  /** Stage 4: the combo's level (x1-x5), the score so far, the FINAL MOVE is up, knocked down (CONTINUE?). */
  combo_level?: number;
  score?: number;
  finale?: boolean;
  down?: { deadline: string; continues: number; max: number; coins: number; can_continue: boolean } | null;
  /** Stage 3: the effects on your champion, every move locked now (creature or effect), no spells / no potions. */
  effects?: ActiveEffect[];
  locked_moves?: Move[];
  silenced?: boolean;
  cursed?: boolean;
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
  /** The creature's special turn this question belongs to (riddle, illusion, hoard...), if any. */
  special?: IntentKind | null;
  /** A Sphinx riddle: Insight can't be cast on it. */
  riddle?: boolean;
  time_limit: number;
  expires_at: string;
  seconds_left: number;
  /** Stage 4: the FINAL MOVE's question (one quick question to finish the boss). */
  finale?: boolean;
  /** Stage 3: what the effects do to this question's screen (seconds of hidden options / blurred text, reshuffles). */
  effects?: { blind: number; fog: number; shuffle: number } | null;
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
  /** The boss's blow missed you entirely (a dodged boulder, Shadowstep, Vanish). */
  dodged?: boolean;
  /** Kaien's Riposte: damage hit back on a right Guard (inside damage_dealt). */
  riposte?: number;
  kit_meter_gained?: number;
  mechanic?: MechanicOutcome | null;
  kit?: KitOutcome | null;
  /** The bane landed (x1.5, the boss lost its turn); `found`: worked out alone, rewarded once. */
  bane?: { landed: boolean; found: boolean } | null;
  /** Stage 4: the combo's level, a combo special, this answer's points and the score; the final move. */
  combo_level?: number;
  combo_special?: boolean;
  points?: number;
  score?: number;
  finale_armed?: boolean;
  finisher?: { name: string; champion: string; style: string | null } | null;
  finale_missed?: boolean;
  knocked_down?: boolean;
  /** Stage 3: the effect that landed, the ones that ticked (and their damage), the ones that wore off. */
  effects?: {
    landed: IntentEffect | null; ticked: { id: string; name: string; damage: number }[]; expired: string[];
    damage: number; sapped: number; drained: number; active: ActiveEffect[];
  } | null;
  new_achievements?: { id: string; name: string; description: string }[];
}

export interface AnswerResponse extends Outcome { ok: boolean; replayed: boolean; battle: Battle; rewards: BattleRewards | null }
export interface QuestionResponse { ok: boolean; battle: Battle; question: Question | null; previous: Outcome | null; stock?: Stock }
export interface ItemResponse { ok: boolean; item: ItemId; battle: Battle; question: Question | null; stock: Stock }
export interface ForfeitResponse { ok: boolean; battle: Battle; rewards: BattleRewards | null }
export interface TauntResponse { ok: boolean; taunt: { meter_gain: number; enraged: boolean; bonus_pct: number }; battle: Battle }
export interface EmoteEntry { id: string; name: string; owned: boolean; how: string }

export interface UltimateResponse {
  ok: boolean; ultimate: { name: string; text: string; hearts: number; insight: boolean; timewarp: boolean };
  battle: Battle; question: Question | null;
}
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

// ── Stage 6: power level, Boss Rush and Survival ─────────────────────────────────────────────────────────────
export type GauntletKind = "rush" | "survival";
export interface GauntletChest { size: "chest" | "big"; coins: number; xp: number; at?: number; items: { id: string; name: string; kind: "potion" | "skin" }[] }
export interface GauntletResult { status: "won" | "lost" | "abandoned"; stage: number; score: number; power: number; chests: number; accuracy: number }
/** What a fight of the run did to it (on the battle's result). */
export interface GauntletStep {
  gauntlet_id: string; kind: GauntletKind; stage: number; over: boolean; status: "active" | "won" | "lost";
  chest: GauntletChest | null; result?: GauntletResult | null;
  /** Boss Rush: the next boss; Survival: the next boss's power. */
  next?: { species?: string; name?: string; difficulty?: string; power: number };
  next_chest_at?: number;
}
export interface RushBoss { species: string; name: string; difficulty: string; power: number; beaten: boolean }
export interface Gauntlet {
  gauntlet_id: string; kind: GauntletKind; status: "active" | "won" | "lost" | "abandoned"; topic: string; session_id: string; power: number; stage: number;
  hearts: number; max_hearts: number; battle_id: string | null; score: number; chests: GauntletChest[]; answered: number; correct: number;
  bosses_total?: number; plan?: RushBoss[]; next_power?: number; next_chest_at?: number; result?: GauntletResult;
}
export interface PowerLevel { power: number; from_score: number; from_hunts: number; best_scores: number[]; hunted: string[] }
export interface PowerOverview {
  ok: boolean; power: PowerLevel;
  rush: { unlocked: boolean; hunted: number; need: number; bosses: { species: string; name: string }[]; wins: number; best: { stage: number; score: number } | null };
  survival: { best: { stage: number; score: number } | null };
  active: Gauntlet | null;
}
export interface GauntletFightResponse { ok: boolean; gauntlet: Gauntlet; battle_id: string; boss: BossProfile; battle: Battle }
