// Arena boss fights, decided by the server (Stage 4.5b; port of backend/services/arena_service.py).
//   create        a battle row + boss + its first telegraphed intent; never an answer
//   nextQuestion  the next question for the player's MOVE (strike / jab / heavy / guard picks its tier, time and
//                 damage; Heavy's Focus is paid here), options shuffled, a server deadline. Asking again returns the
//                 same question and the time left
//   answer        graded here; resolves the turn both ways (the player's hit, the boss's intent, Focus, relics,
//                 the creature's mechanic, the champion's kit, mastery) and rolls the next intent. First answer final
//   end           exactly once (compare-and-set on status): rewards, leaderboard row, personal best, champion XP;
//                 a run battle hands its end to the expedition instead
// Questions: a fight is PREPARED before it starts (prepare: the whole fight's questions, normal and enraged, written
// side by side), so it never stops to wait for the model. Long fights are topped up in the background
// (ctx.waitUntil) well before they run low; a model failure never decides a fight: the request is retryable.
import { and, asc, count, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { FINISHERS, STYLE_FINISHERS } from "@/lib/arena/finishers";
import * as insight from "./insight";
/** Two worlds, Stage 5: the Focus full Insight adds to a fight's start. */
export const INSIGHT_FOCUS = 1;
import { background } from "../env";
import type { RequestContext } from "../context";
import { arenaBattles, arenaGauntlets, arenaPersonalBests, arenaQuestions, arenaScores, championProgress, courseDocuments, courses, documents, user as userTable } from "../db/schema";
import { HttpError } from "../http";
import type { Caller } from "../ai/run";
import { record as recordMastery } from "../study/mastery";
import { questionKey, sameAnswer } from "../study/text";
import { bossFlavor, generateBattleQuiz, questionTier, type BattleQuestion } from "./arena-ai";
import { baseBoss, summon } from "./bestiary";
import * as tome from "./tome";
import * as roster from "./roster";
import * as mastery from "./mastery";
import * as build from "./build";
import * as forge from "./forge";
import * as scrolls from "./scrolls";
import { bossTaunt, intentBaseDamage, makeIntent, mergeFlavor, playerHit, rollIntent, sanitizeBoss, type Boss, type Intent } from "./boss";
import { ITEMS } from "./content";
import * as kits from "./kits";
import * as effects from "./effects";
import { DAMAGING_KINDS, forBoss, illusionOption, key as mkey, Turn } from "./mechanics";
import { award, activeBuffs, checkAchievements, consumeCharge } from "./progression";
import { consumeInventory, getAvatar, inventory, modifyAvatar, recordRewardEvent, type Player } from "./store";

export const PLAYER_MAX_HP = 10;
/** All damage bonuses from gear and forge tiers together stay at or under +40%: right answers decide fights. */
export const DAMAGE_CAP = 0.4;
const SECONDS_PER_QUESTION = 30;
const DEADLINE_GRACE_MS = 3000;
const MAX_ANSWERS = 40;
const ROUND_SIZE = 5;
const BATCH_SIZE = 6;
const MAX_BATCHES_PER_PHASE = 6;
const LOW_WATER = 4;
/** A fight's questions before it starts: enough for the whole fight (phase 2 is the enraged part). */
export const PREPARED = { phase1: 12, phase2: 8, minToStart: 5 } as const;
const HEAL_ITEM = "potion_health_small", FIFTY_ITEM = "fifty_fifty";
const HP_PACING: Record<string, number> = { easy: 2.6, medium: 2.4, hard: 2.6, nightmare: 2.8 };
const GEAR_SLOTS = ["weapon", "armor", "headgear", "pet"];
const BOSS_DEFEAT_DIFFICULTY: Record<string, number> = { easy: 1.2, medium: 1.5, hard: 1.8, nightmare: 2.5 };
export const MOVES: Record<string, { tier: string; mult: number; seconds: number | null; cost: number }> = {
  strike: { tier: "medium", mult: 1, seconds: null, cost: 0 }, jab: { tier: "easy", mult: 0.6, seconds: 15, cost: 0 },
  heavy: { tier: "hard", mult: 1.8, seconds: null, cost: 2 }, guard: { tier: "medium", mult: 0, seconds: null, cost: 0 },
};
const DEFAULT_MOVE = "strike";
const TIER_ORDER: Record<string, string[]> = { easy: ["easy", "medium", "hard"], medium: ["medium", "easy", "hard"], hard: ["hard", "medium", "easy"] };
export const FOCUS_CAP = 5;
const SPELLS: Record<string, number> = { insight: 1, timewarp: 1 };
const TIMEWARP_SECONDS = 15;
const INTERRUPTING = ["strike", "heavy"];
const OWL_FEATHER_SECONDS = 5, PHOENIX_HEARTS = 3, VAMPIRIC_COMBO = 5, FOCUS_CRYSTAL_START = 2;

// ── Stage 4: the combo, the final move, the score card, CONTINUE ───────────────────────────────────────────
/** The combo's level: x1 until 3 in a row, then one step each right answer, up to x5 (6 in a row). */
export const comboLevel = (combo: number) => (combo < 3 ? 1 : Math.min(5, combo - 1));
/** Each level past x1 hits a little harder, and charges the ultimate a little faster. */
const COMBO_DAMAGE_STEP = 0.08, COMBO_METER_STEP = 0.15;
/** At x5 the next right answer is a combo special (x1.5, its own animation), and every third one after. */
export const isComboSpecial = (combo: number) => combo >= 7 && (combo - 7) % 3 === 0;
const COMBO_SPECIAL_MULT = 1.5;
/** Below this share of its HP the boss is on its knees: one quick question for the FINAL MOVE. */
export const FINALE_PCT = 0.15;
const FINALE_SECONDS = 12, FINALE_RECOVER_PCT = 0.1;
/** CONTINUE: up to 3 a fight, with a health potion from the bag or coins (the price doubles each time). */
export const MAX_CONTINUES = 3, CONTINUE_SECONDS = 10, CONTINUE_COINS = 100;
const CONTINUE_GRACE_MS = 5000;
export const continueCoins = (used: number) => CONTINUE_COINS * 2 ** used;
/** Score: a right answer's points by tier, half again for speed, times the combo; the finisher, hearts left. */
const POINTS: Record<string, number> = { easy: 100, medium: 150, hard: 250 };
const FINISHER_POINTS = 1000, HEART_POINTS = 50, CONTINUE_KEEPS = 0.75;

/** Each champion's FINAL MOVE (their signature weapon's finisher when they wield it); your hero's comes from its style. */
function finisherFor(k: kits.KitState): { name: string; champion: string; style: string | null } {
  if (k.champion === build.HERO_ID) return { name: STYLE_FINISHERS[k.style ?? "apprentice"] ?? "Final Move", champion: k.champion, style: k.style ?? null };
  const sig = k.signature ? kits.kitHud(k).signature?.finisher : null;
  return { name: sig ?? FINISHERS[k.champion] ?? "Final Move", champion: k.champion, style: null };
}
/** The score so far: points, the finisher, and (a won fight) hearts left; each continue keeps 75% of it. */
function scoreTotal(boss: Boss, heartsLeft: number): number {
  const sc = boss.score ?? {};
  const raw = Number(sc.points ?? 0) + Number(sc.finisher ?? 0) + Math.max(0, heartsLeft) * HEART_POINTS;
  return Math.round(raw * CONTINUE_KEEPS ** Number(boss.continues ?? 0));
}
/** The score card's rank: points per answer. */
export function scoreRank(total: number, answered: number) {
  const per = total / Math.max(1, answered);
  for (const [floor, r] of [[600, "S"], [420, "A"], [300, "B"], [200, "C"]] as const) if (per >= floor) return r;
  return "D";
}

type Row = typeof arenaBattles.$inferSelect;
type QRow = typeof arenaQuestions.$inferSelect;
const iso = (d = new Date()) => d.toISOString();
const J = <T = any,>(s: string | null | undefined, d: T): T => { if (!s) return d; try { return JSON.parse(s) as T; } catch { return d; } };
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const err = (code: string, message: string, details: Record<string, unknown> | null = null, status = 409) => new HttpError(status, code, message, null, details);
const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const normTopic = (topic: unknown) => String(topic ?? "general").toLowerCase().split(/\s+/).filter(Boolean).join(" ").slice(0, 100) || "general";
const boardKey = (topic: string, difficulty: string, docHash: string) => `${normTopic(topic)}|${difficulty}|${docHash}`;
export function gradeFor(accuracy: number) {
  for (const [floor, g] of [[95, "S+"], [90, "S"], [80, "A"], [70, "B"], [60, "C"], [50, "D"]] as const) if (accuracy >= floor) return g;
  return "F";
}

/** What the worn items do in a fight (the shop's `battle` fields), summed: a snapshot taken at the start. */
export function gearFor(equipped: Record<string, string>) {
  const worn: Record<string, string> = Object.fromEntries(GEAR_SLOTS.map((s) => [s, equipped[s] || ""]).filter(([, v]) => v));
  const stats = Object.values(worn).map((id) => ITEMS.get(id)?.battle ?? {});
  return {
    items: worn, damage_pct: Math.round(stats.reduce((a, s) => a + Number(s.damage_pct ?? 0), 0) * 10_000) / 10_000,
    hp: stats.reduce((a, s) => a + Number(s.hp ?? 0), 0), time_sec: stats.reduce((a, s) => a + Number(s.time_sec ?? 0), 0),
    strike: stats.reduce((a, s) => a + Number(s.strike ?? 0), 0),
  };
}
const relicsOf = (boss: Boss) => new Set<string>(boss.mods?.relics ?? []);
/** The answer clock: the move's time, the tier, gear, relics and the kit; frozen / slowed by effects and a little
 *  shorter while the boss rages (effects.clockFactor). */
const timeLimit = (boss: Boss, move?: string | null) => Math.max(MIN_SECONDS, Math.round((
  Math.round((MOVES[move || DEFAULT_MOVE]?.seconds ?? SECONDS_PER_QUESTION) * (tome.TIER_TIME[(boss.tier ?? 1) as 1 | 2 | 3 | 4] ?? 1))
  + Number(boss.gear?.time_sec ?? 0) + (relicsOf(boss).has("owl_feather") ? OWL_FEATHER_SECONDS : 0)
  + (boss.kit ? kits.timeBonusFor(boss.kit, move || DEFAULT_MOVE) : 0)) * effects.clockFactor(boss)));
const MIN_SECONDS = 6;
const FINALE_INTENT: Intent = { kind: "finale", name: "On its knees", value: 0, special: true,
  description: "It can barely stand: one quick question for your FINAL MOVE. Miss, and it staggers back up." };
const questionLimit = (boss: Boss, q: QRow) =>
  boss.finale?.seq === q.seq ? Math.min(FINALE_SECONDS, timeLimit(boss, q.move)) : timeLimit(boss, q.move) + (q.timewarped ? TIMEWARP_SECONDS : 0);
const heavyCost = (boss: Boss) => kits.heavyCostFor(boss.kit?.champion, relicsOf(boss).has("whetstone") ? 1 : MOVES.heavy.cost, boss.kit);
const moveCost = (move: string, boss: Boss) => (move === "heavy" ? heavyCost(boss) : MOVES[move].cost);
const shieldFactor = (boss: Boss) => (relicsOf(boss).has("ink_bomb") ? 0.5 : 1);
export function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
const isWeakness = (boss: Boss, q: { concept?: string }) => {
  const w = String(boss.weakness ?? "").trim().toLowerCase(), c = String(q.concept ?? "").trim().toLowerCase();
  return !!(w && c && (w.includes(c) || c.includes(w)));
};
/** The boss's next move: its creature's scheduled one, else (enraged) its signature blow every few turns, else a roll.
 *  A blow may carry an effect (telegraphed with it; effects.ts). */
function nextIntentFor(boss: Boss, difficulty: string, turn: number): Intent {
  if (boss.finale?.armed) return FINALE_INTENT;
  const m = forBoss(boss);
  const scheduled = m ? m.scheduled(boss.mech ?? {}, boss, difficulty, turn) : null;
  if (scheduled) return effects.attach(scheduled, effects.chooseEffect(boss, DAMAGING_KINDS.includes(scheduled.kind)));
  const fury = effects.furyIntent(boss, intentBaseDamage(boss, difficulty), turn);
  if (fury) return fury;
  const rolled = rollIntent(boss, difficulty, shieldFactor(boss));
  return effects.attach(rolled, effects.chooseEffect(boss, DAMAGING_KINDS.includes(rolled.kind)));
}
const mechanicHud = (boss: Boss, difficulty: string) => forBoss(boss)?.hud(boss.mech ?? {}, boss, difficulty) ?? null;
/** Every move locked now: by the creature (a Kraken's grab) or by an effect (a stun). */
const lockedMoves = (boss: Boss) => [...new Set([...(forBoss(boss)?.lockedMoves(boss.mech ?? {}) ?? []), ...effects.lockedMoves(boss)])];

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────
const row = (ctx: RequestContext, id: string, userId: number) =>
  ctx.db.select().from(arenaBattles).where(and(eq(arenaBattles.id, String(id)), eq(arenaBattles.userId, userId))).get();
async function need(ctx: RequestContext, id: string, userId: number): Promise<Row> {
  const b = await row(ctx, id, userId);
  if (!b) throw new HttpError(404, "battle_not_found", "We couldn't find that battle.");
  return b;
}
const qrow = (ctx: RequestContext, battleId: string, seq: number) =>
  ctx.db.select().from(arenaQuestions).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, seq))).get();

export function state(b: Row) {
  const boss: Boss = J(b.bossJson, {});
  return {
    battle_id: b.id, status: b.status, session_id: b.sessionId, topic: b.topic, difficulty: b.difficulty, phase: b.phase, rage: !!boss.rage, prepared: !!boss.prepared,
    boss: { name: boss.name, hp: b.bossHp, max_hp: b.bossMaxHp, species: boss.species, title: boss.title, origin: boss.origin },
    /** Two worlds, Stage 7: a season's boss fights on its own stage. */
    stage: boss.stage ?? null, season: boss.season ?? null,
    player: { hp: b.playerHp, max_hp: b.playerMaxHp }, combo: b.combo, max_combo: b.maxCombo, answered: b.answered, correct: b.correct,
    heals_used: b.healsUsed, fifty_used: b.fiftyUsed, gear: boss.gear ?? {}, mode: b.mode, run_id: b.runId, gauntlet_id: b.gauntletId ?? null, focus: b.focus,
    focus_cap: b.focusCap, shield: b.shield, intent: b.intentJson && b.status === "active" ? J(b.intentJson, null) : null,
    relics: [...relicsOf(boss)].sort(), heavy_cost: heavyCost(boss), question_issued: b.status === "active" && b.currentSeq !== null,
    free_timewarp: relicsOf(boss).has("hourglass") && !boss.mods?.hourglass_used, mechanic: mechanicHud(boss, b.difficulty),
    kit: boss.kit ? kits.kitHud(boss.kit) : null, tier: boss.tier ?? 1, bane: tome.baneHud(boss), taunted: !!boss.mods?.taunted,
    effects: effects.hud(boss), locked_moves: lockedMoves(boss), silenced: effects.silenced(boss), cursed: effects.cursed(boss),
    combo_level: comboLevel(b.combo), score: boss.score?.total ?? 0, finale: !!boss.finale?.armed,
    paused: !!boss.paused, pauses_left: Math.max(0, MAX_PAUSES - Number(boss.pauses ?? 0)),
    insight: boss.mods?.insight ? { fifty: !!boss.mods.insight.fifty, focus: INSIGHT_FOCUS } : null,
    down: b.status === "active" && boss.down ? { deadline: boss.down.deadline, continues: Number(boss.continues ?? 0), max: MAX_CONTINUES,
      coins: continueCoins(Number(boss.continues ?? 0)), can_continue: Number(boss.continues ?? 0) < MAX_CONTINUES } : null,
    ...(b.status !== "active" ? { result: J(b.resultJson, {}), rewards: J(b.rewardsJson, null) } : {}),
  };
}

export function publicBoss(b: Row) {
  const boss: Boss = J(b.bossJson, {});
  delete boss.asked_concepts;
  return boss;
}

function publicQuestion(q: QRow, b: Row) {
  const question = J<BattleQuestion>(q.questionJson, {} as BattleQuestion);
  const removed: string[] = J(q.removedJson, []);
  const boss: Boss = J(b.bossJson, {});
  const intent: Partial<Intent> = J(b.intentJson, {});
  return {
    special: intent.special ? intent.kind : null, riddle: intent.kind === "riddle", id: q.seq, number: b.answered + 1,
    question: question.question, options: J<string[]>(q.optionsJson, []).filter((o) => !removed.includes(o)), concept: question.concept,
    difficulty: question.difficulty, phase: q.phase, move: q.move || DEFAULT_MOVE, tier: questionTier(question.difficulty, b.difficulty),
    weakness: isWeakness(boss, question), fifty_used: removed.length > 0, timewarped: !!q.timewarped, time_limit: questionLimit(boss, q),
    effects: q.status === "issued" ? effects.questionFx(boss) : null, finale: boss.finale?.seq === q.seq,
    expires_at: q.deadlineAt, seconds_left: Math.round(Math.max(0, (Date.parse(q.deadlineAt!) - Date.now()) / 1000) * 10) / 10,
  };
}

export async function findActive(ctx: RequestContext, userId: number, sessionId?: string | null) {
  const b = await ctx.db.select().from(arenaBattles).where(and(eq(arenaBattles.userId, userId), eq(arenaBattles.status, "active"),
    ...(sessionId ? [eq(arenaBattles.sessionId, sessionId)] : []))).orderBy(desc(arenaBattles.createdAt)).get();
  if (!b) return null;
  await settleTimeout(ctx, b.id, userId);
  return (await row(ctx, b.id, userId)) ?? null;
}

export async function getBattle(ctx: RequestContext, userId: number, id: string) {
  await need(ctx, id, userId);
  await settleTimeout(ctx, id, userId);
  return need(ctx, id, userId);
}

/** The documents a battle's questions come from (a document, or a course's ready ones). */
async function docsFor(ctx: RequestContext, userId: number, sessionId: string) {
  const d = await ctx.db.select().from(documents).where(and(eq(documents.id, sessionId), eq(documents.userId, userId), eq(documents.status, "ready"))).get();
  if (d) return [{ id: d.id, name: d.filename }];
  const c = await ctx.db.select().from(courses).where(and(eq(courses.id, sessionId), eq(courses.userId, userId))).get();
  if (!c) return [];
  const rows = await ctx.db.select({ d: documents }).from(courseDocuments).innerJoin(documents, eq(documents.id, courseDocuments.documentId))
    .where(eq(courseDocuments.courseId, c.id)).orderBy(courseDocuments.position).all();
  return rows.filter((r) => r.d.status === "ready").map((r) => ({ id: r.d.id, name: r.d.filename }));
}

// ── creating ─────────────────────────────────────────────────────────────────────────────────────────────────
/** The boss for a fight: instant (a bestiary creature from the topic); its topic lines come later (enrich). */
/**
 * A boss for `topic`. `hunt` (round 7, the Bestiary's Hunt button): that creature, whatever the topic would call -
 * only one whose page is open (the caller checks).
 */
export async function newBoss(topic: string, difficulty: string, open: Set<string> | null = null, hunt: string | null = null): Promise<Boss> {
  const { species, wanted } = hunt ? { species: hunt, wanted: hunt } : await summon(topic, open);
  const boss = sanitizeBoss(baseBoss(species, topic, difficulty), difficulty);
  Object.assign(boss, { current_hp: boss.max_hp, phase: 1, rage: false, asked_concepts: [], rounds_fought: 0, total_damage_taken: 0, total_damage_dealt: 0, flavor_pending: true });
  // a locked creature the topic called for (the Bestiary page remembers it); not part of the boss shown to the player
  if (wanted !== species) Object.defineProperty(boss, "wanted", { value: wanted, enumerable: false });
  return boss;
}

/** The creatures a topic may summon for this player (the Bestiary's open tiers). */
export async function summonable(ctx: RequestContext, userId: number): Promise<Set<string>> {
  return tome.openSpecies(await tome.records(ctx, userId));
}

/**
 * Arm the fighter from the account as it is now: the champion it fights as (its kit), the gear worn and its forge
 * tiers, and the mount. Written onto the boss record (the fight reads it from there).
 */
async function armFighter(ctx: RequestContext, userId: number, boss: Boss) {
  const avatar = await getAvatar(ctx, userId);
  boss.gear = gearFor(avatar.equipped);
  // the forge: each worn item's tier adds a small capped bonus (forge.ts); a saddled pet ridden as a mount adds its own
  const heroStyle = avatar.championId === build.HERO_ID ? (await build.heroKit(ctx, userId, "")).style ?? null : null;
  const worn = forge.wornItems(avatar.equipped, heroStyle);
  const tiers = await forge.tiersOf(ctx, userId, worn);
  const tierOf = (slot: string) => forge.bonusFor(tiers[slot === "weapon" && heroStyle && !avatar.equipped.weapon ? `style:${heroStyle}` : avatar.equipped[slot] ?? ""] ?? 1);
  boss.gear.damage_pct = Math.min(DAMAGE_CAP, Number(boss.gear.damage_pct ?? 0) + tierOf("weapon"));
  boss.gear.guard_pct = tierOf("armor") + tierOf("headgear");
  boss.gear.strike = Math.round(Number(boss.gear.strike ?? 0) * (1 + tierOf("pet")));
  boss.gear.worn = worn;
  boss.mount = avatar.equipped.mount ? forge.MOUNT_KIND[avatar.equipped.mount] ?? "beast" : null;
  // your hero brings its built kit (build.ts); a champion its own, with a small perk for its own mastery weapon (kits.SIGNATURES)
  if (avatar.championId === build.HERO_ID) {
    const u = await ctx.db.select({ name: userTable.username }).from(userTable).where(eq(userTable.id, userId)).get();
    boss.kit = await build.heroKit(ctx, userId, u?.name || "Your hero");
  } else boss.kit = kits.initKit(avatar.championId, kits.hasSignature(kits.kitFor(avatar.championId).champion, avatar.equipped));
}

/** The start of a fight for this kit: hearts, the Focus cap and the Focus it opens with. */
function openingFor(boss: Boss, mods: Record<string, any>, focusCapBase = FOCUS_CAP) {
  const hearts = kits.heartsFor(boss.kit.champion, PLAYER_MAX_HP + boss.gear.hp, boss.kit);
  const focusCap = kits.focusCapFor(boss.kit, focusCapBase);
  const focus = Math.min(focusCap, ((mods.relics ?? []).includes("focus_crystal") ? FOCUS_CRYSTAL_START : 0) + Number(mods.focus_bonus ?? 0) + kits.startFocusFor(boss.kit)
    + (mods.insight ? INSIGHT_FOCUS : 0));
  return { hearts, focusCap, focus };
}

/**
 * Character select (Stage 5): the champion is picked while the fight's questions are written, after the battle
 * exists. Before its first question, the fight re-arms for the account's champion now (hearts, Focus, kit, gear).
 * A run's fight keeps the champion of the run.
 */
export async function rearm(ctx: RequestContext, userId: number, battleId: string): Promise<Row> {
  for (let i = 0; i < 3; i++) {
    const b = await need(ctx, battleId, userId);
    if (b.status !== "active" || b.runId || b.answered > 0 || b.currentSeq !== null) {
      throw err("battle_started", "This fight has already started: your champion is set for it.");
    }
    // Boss Rush / Survival: the champion is picked for the first boss; after it, hearts carry over with them
    if (b.gauntletId) {
      const g = await ctx.db.select({ stage: arenaGauntlets.stage }).from(arenaGauntlets).where(eq(arenaGauntlets.id, b.gauntletId)).get();
      if ((g?.stage ?? 0) > 0) throw err("battle_started", "Your champion is set for this run of fights.");
    }
    const boss: Boss = J(b.bossJson, {});
    await armFighter(ctx, userId, boss);
    const open = openingFor(boss, boss.mods ?? {});
    const done = await ctx.db.update(arenaBattles)
      .set({ bossJson: JSON.stringify(boss), playerHp: open.hearts, playerMaxHp: open.hearts, focus: open.focus, focusCap: open.focusCap, updatedAt: iso() })
      .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.bossJson, b.bossJson), isNull(arenaBattles.currentSeq), eq(arenaBattles.answered, 0)))
      .returning({ id: arenaBattles.id }).all();
    if (done.length) return need(ctx, battleId, userId);
  }
  throw err("battle_busy", "The fight changed while your champion was being set. Try again.");
}

export async function createBattle(ctx: RequestContext, userId: number, o: {
  sessionId: string; docHash: string; topic: string; difficulty: string; boss: Boss; mode?: string; runId?: string | null;
  hearts?: number | null; maxHearts?: number | null; mods?: Record<string, unknown>; hpScale?: number; targets?: string[] | null; focusCap?: number;
  gauntletId?: string | null;
}): Promise<Row> {
  const boss = sanitizeBoss({ ...o.boss }, o.difficulty);
  // Bestiary tier: more HP (and, through boss.tier, less time and harder blows); the bane shows once it is known.
  boss.tier = tome.tierOf(String(boss.species ?? ""));
  boss.bane_known = tome.baneKnown((await tome.records(ctx, userId)).get(String(boss.species ?? "")));
  if (o.boss.wanted && o.boss.wanted !== boss.species) await tome.noteTeaser(ctx, userId, o.boss.wanted, o.topic);
  boss.max_hp = Math.round(boss.max_hp * (HP_PACING[o.difficulty] ?? 2.6) * (o.hpScale ?? 1) * (tome.TIER_HP[boss.tier as 1 | 2 | 3 | 4] ?? 1));
  boss.difficulty = o.difficulty;
  boss.current_hp = boss.max_hp;
  await armFighter(ctx, userId, boss);
  const mods: Record<string, any> = { ...(o.mods ?? {}) };
  mods.relics ??= [];
  Object.assign(mods, { aegis_used: false, hourglass_used: false });
  // two worlds, Stage 5: full Insight (from studying) gives this fight an edge, once: +1 Focus and a free 50/50
  if (await insight.takeInsight(ctx, userId)) mods.insight = { fifty: true };
  boss.mods = mods;
  if (o.targets?.length) boss.target_concepts = [...o.targets];
  const open = openingFor(boss, mods, o.focusCap ?? FOCUS_CAP);
  let hearts: number, maxHearts: number;
  if (o.hearts === null || o.hearts === undefined) hearts = maxHearts = open.hearts;
  else { hearts = o.hearts; maxHearts = o.maxHearts ?? o.hearts; }
  Object.assign(boss, { phase: 1, rage: false, rounds_fought: 0, total_damage_taken: 0, total_damage_dealt: 0, asked_concepts: [] });
  const mech = forBoss(boss);
  if (mech) boss.mech = mech.init(boss, o.difficulty);
  effects.initEffects(boss);
  const { focusCap, focus } = open;
  const intent = nextIntentFor(boss, o.difficulty, 1);
  const now = iso();
  const id = crypto.randomUUID().replace(/-/g, "");
  try {
    await ctx.db.insert(arenaBattles).values({
      id, userId, sessionId: o.sessionId, docHash: o.docHash, topic: o.topic, difficulty: o.difficulty, boardKey: boardKey(o.topic, o.difficulty, o.docHash),
      bossJson: JSON.stringify(boss), bossHp: boss.max_hp, bossMaxHp: boss.max_hp, playerHp: hearts, playerMaxHp: maxHearts, createdAt: now,
      updatedAt: now, mode: o.mode ?? "quick", runId: o.runId ?? null, gauntletId: o.gauntletId ?? null, focus, focusCap, intentJson: JSON.stringify(intent),
    });
  } catch (e) {
    if (String((e as Error)?.message ?? e).includes("UNIQUE")) throw err("battle_in_progress", "You already have a battle running for this document.");
    throw e;
  }
  return need(ctx, id, userId);
}

// ── the question pool ────────────────────────────────────────────────────────────────────────────────────────
const attempts = (b: Row, phase: number) => (phase === 1 ? b.genAttempts1 : b.genAttempts2);
async function poolSize(ctx: RequestContext, battleId: string, phase: number) {
  return (await ctx.db.select({ n: count() }).from(arenaQuestions).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.phase, phase), eq(arenaQuestions.status, "queued"))).get())?.n ?? 0;
}

/** Add a batch to the pool: one question per concept (and never the same text twice). */
async function storeBatch(ctx: RequestContext, battleId: string, phase: number, questions: BattleQuestion[]) {
  const b = await ctx.db.select({ boss: arenaBattles.bossJson, difficulty: arenaBattles.difficulty }).from(arenaBattles).where(eq(arenaBattles.id, battleId)).get();
  const nemesis = !!(b && J<Boss>(b.boss, {}).target_concepts);
  const rows = await ctx.db.select({ c: arenaQuestions.conceptKey, t: arenaQuestions.textKey, seq: arenaQuestions.seq }).from(arenaQuestions).where(eq(arenaQuestions.battleId, battleId)).all();
  const concepts = new Set(rows.map((r) => r.c)), texts = new Set(rows.map((r) => r.t));
  let next = Math.max(0, ...rows.map((r) => r.seq)) + 1;
  const fresh: [string, string, BattleQuestion][] = [], repeats: [string, string, BattleQuestion][] = [];
  for (const raw of questions) {
    const q = { ...raw, difficulty: questionTier(raw.difficulty, b?.difficulty ?? "medium") };
    const tk = questionKey(q.question), ck = questionKey(q.concept) || tk;
    if (!tk || texts.has(tk)) continue;
    (concepts.has(ck) && !nemesis ? repeats : fresh).push([ck, tk, q]);
    concepts.add(ck); texts.add(tk);
  }
  // The new questions in one round trip (a D1 batch), one statement each (D1 allows 100 bound parameters per statement).
  const inserts = (fresh.length ? fresh : repeats).map(([ck, tk, q]) =>
    ctx.db.insert(arenaQuestions).values({ battleId, seq: next++, phase, conceptKey: ck, textKey: tk, questionJson: JSON.stringify(q) }).onConflictDoNothing());
  if (inserts.length) await ctx.db.batch(inserts as [typeof inserts[number], ...typeof inserts]);
  const col = phase === 1 ? arenaBattles.genAttempts1 : arenaBattles.genAttempts2;
  await ctx.db.update(arenaBattles).set({ [phase === 1 ? "genAttempts1" : "genAttempts2"]: sql`${col} + 1` }).where(eq(arenaBattles.id, battleId));
}

/** Write ONE batch for a phase. Returns the failure instead of throwing (the caller decides). */
async function fillOnce(ctx: RequestContext, caller: Caller, battleId: string, userId: number, phase: number, force = false): Promise<unknown> {
  try {
    const b = await row(ctx, battleId, userId);
    if (!b || b.status !== "active" || (attempts(b, phase) >= MAX_BATCHES_PER_PHASE && !force)) return null;
    const docs = await docsFor(ctx, userId, b.sessionId);
    if (!docs.length) return new HttpError(400, "session_expired", "Your document session has expired. Please upload your PDF again.", "reupload");
    const asked = (await ctx.db.select({ q: arenaQuestions.questionJson }).from(arenaQuestions).where(eq(arenaQuestions.battleId, battleId)).all())
      .map((r) => J<BattleQuestion>(r.q, {} as BattleQuestion).concept).filter(Boolean);
    const boss: Boss = J(b.bossJson, {});
    const quiz = await generateBattleQuiz(ctx, caller, docs, {
      topic: b.topic, difficulty: b.difficulty, n: BATCH_SIZE, asked, phase, targets: boss.target_concepts ?? [], riddles: boss.species === "sphinx",
    });
    await storeBatch(ctx, battleId, phase, quiz);
    return null;
  } catch (e) {
    console.warn(`[coursemate-arena] battle ${battleId}: phase ${phase} questions failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
    return e;
  }
}

/**
 * Write the fight's questions before it starts: two phase-1 batches (reading different passages, so they ask about
 * different things) and the enraged phase's batch, side by side. Once this returns the fight never waits for the
 * model again. Safe to call again: a prepared battle returns at once. Throws a retryable error only when not even
 * the opening questions could be written (the battle stays; asking again resumes it).
 */
export async function prepare(ctx: RequestContext, caller: Caller, battleId: string, userId: number): Promise<void> {
  const b = await need(ctx, battleId, userId);
  if (b.status !== "active" || J<Boss>(b.bossJson, {}).prepared) return;
  const docs = await docsFor(ctx, userId, b.sessionId);
  if (!docs.length) throw new HttpError(400, "session_expired", "Your document session has expired. Please upload your PDF again.", "reupload");
  const boss: Boss = J(b.bossJson, {});
  const opts = { topic: b.topic, difficulty: b.difficulty, asked: [], targets: boss.target_concepts ?? [], riddles: boss.species === "sphinx" };
  // the batches land one at a time (each numbers its questions after the last)
  let saving: Promise<void> = Promise.resolve();
  const write = (phase: number, n: number, angle: string) => generateBattleQuiz(ctx, caller, docs, { ...opts, n, phase, angle })
    .then((qs) => { saving = saving.then(() => storeBatch(ctx, battleId, phase, qs)); return saving; });
  const half = Math.ceil(PREPARED.phase1 / 2);
  const results = await Promise.allSettled([
    write(1, half, ""), write(1, PREPARED.phase1 - half, "examples applications details"), write(2, PREPARED.phase2, "advanced tricky"),
  ]);
  await saving.catch(() => {});
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected")?.reason;
  if (failure) console.warn(`[coursemate-arena] battle ${battleId}: a prepared batch failed: ${failure instanceof Error ? failure.message.slice(0, 160) : failure}`);
  // short on openers: one more try, then give up retryably (an expired document says so instead)
  if (await poolSize(ctx, battleId, 1) < PREPARED.minToStart) {
    const again = await fillOnce(ctx, caller, battleId, userId, 1, true);
    if (await poolSize(ctx, battleId, 1) === 0) {
      if (again instanceof HttpError && again.code !== "generation_failed") throw again;
      if (failure instanceof HttpError && failure.code !== "generation_failed") throw failure;
      throw retryable();
    }
  }
  if (await poolSize(ctx, battleId, 2) === 0) await fillOnce(ctx, caller, battleId, userId, 2, true);
  await markPrepared(ctx, battleId, userId);
}

/** Note on the boss that its questions are written (re-read and compare-and-set: the boss's lines may land meanwhile). */
async function markPrepared(ctx: RequestContext, battleId: string, userId: number) {
  for (let i = 0; i < 3; i++) {
    const now = await need(ctx, battleId, userId);
    const boss: Boss = J(now.bossJson, {});
    if (boss.prepared) return;
    boss.prepared = true;
    const done = await ctx.db.update(arenaBattles).set({ bossJson: JSON.stringify(boss) })
      .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.bossJson, now.bossJson))).returning({ id: arenaBattles.id }).all();
    if (done.length) return;
  }
}

/** Background batches: the current phase when it runs low, and phase 2 early so the rage phase never waits. */
export function prefetch(ctx: RequestContext, caller: Caller, battleId: string, userId: number): void {
  background(async () => {
    const b = await row(ctx, battleId, userId);
    if (!b || b.status !== "active") return;
    if (await poolSize(ctx, battleId, b.phase) <= LOW_WATER && attempts(b, b.phase) < MAX_BATCHES_PER_PHASE) await fillOnce(ctx, caller, battleId, userId, b.phase);
    const fresh = (await row(ctx, battleId, userId))!;
    if (fresh.phase === 1 && fresh.genAttempts2 === 0 && await poolSize(ctx, battleId, 1) > 0) await fillOnce(ctx, caller, battleId, userId, 2);
  });
}

/** The boss's topic lines, in the background: until they land (or if they fail) the creature's own lines are used. */
export function enrich(ctx: RequestContext, caller: Caller, battleId: string, userId: number): void {
  background(async () => {
    const b = await row(ctx, battleId, userId);
    if (!b || b.status !== "active") return;
    const boss: Boss = J(b.bossJson, {});
    if (!boss.flavor_pending) return;
    const docs = await docsFor(ctx, userId, b.sessionId);
    if (!docs.length) return;
    const flavor = await bossFlavor(ctx, caller, docs, boss.species ?? "", b.topic);
    const now = await row(ctx, battleId, userId);
    if (!now || now.status !== "active") return;
    await ctx.db.update(arenaBattles).set({ bossJson: JSON.stringify(mergeFlavor(J(now.bossJson, {}), flavor)) })
      .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.updatedAt, now.updatedAt)));
  });
}

async function pickQuestion(ctx: RequestContext, battleId: string, phase: number, tier: string, difficulty: string, riddle: boolean) {
  let queued = await ctx.db.select().from(arenaQuestions).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.phase, phase), eq(arenaQuestions.status, "queued"))).orderBy(asc(arenaQuestions.seq)).all();
  if (riddle) { const r = queued.filter((q) => J<BattleQuestion>(q.questionJson, {} as BattleQuestion).riddle === true); queued = [...r, ...queued.filter((q) => !r.includes(q))]; }
  for (const wanted of TIER_ORDER[tier]) {
    const q = queued.find((x) => questionTier(J<BattleQuestion>(x.questionJson, {} as BattleQuestion).difficulty, difficulty) === wanted);
    if (q) return q;
  }
  return null;
}

const poolAnswers = async (ctx: RequestContext, battleId: string, seq: number) =>
  (await ctx.db.select({ q: arenaQuestions.questionJson }).from(arenaQuestions).where(and(eq(arenaQuestions.battleId, battleId), ne(arenaQuestions.seq, seq))).all())
    .map((r) => J<BattleQuestion>(r.q, {} as BattleQuestion).correct_answer || "");
const poolConcepts = async (ctx: RequestContext, battleId: string) =>
  (await ctx.db.select({ q: arenaQuestions.questionJson }).from(arenaQuestions).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.status, "queued"))).all())
    .map((r) => J<BattleQuestion>(r.q, {} as BattleQuestion).concept || "");

/** Two wrong options for a 50/50 or Insight: a Kitsune's illusion always goes first. */
function twoWrong(q: QRow, boss: Boss): string[] {
  const correct = J<BattleQuestion>(q.questionJson, {} as BattleQuestion).correct_answer;
  const options: string[] = J(q.optionsJson, []);
  const ill = boss.mech?.illusion ?? {};
  const fake = ill.seq === q.seq && options.includes(ill.option) ? ill.option : null;
  const wrong = shuffle(options.filter((o) => !sameAnswer(o, correct) && o !== fake));
  return [...(fake ? [fake] : []), ...wrong.slice(0, 2 - (fake ? 1 : 0))];
}

async function freeSpells(ctx: RequestContext, battleId: string, seq: number, boss: Boss, intent: Intent | null) {
  const q = (await qrow(ctx, battleId, seq))!;
  const mech = forBoss(boss);
  const set: Partial<QRow> = {};
  if (!q.removedJson && !(mech && mech.blocksInsight(intent))) set.removedJson = JSON.stringify(twoWrong(q, boss));
  if (!q.timewarped) { set.deadlineAt = iso(new Date(Date.parse(q.deadlineAt!) + TIMEWARP_SECONDS * 1000)); set.timewarped = 1; }
  if (Object.keys(set).length) await ctx.db.update(arenaQuestions).set(set).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, seq)));
}

/** Hand out the next queued question for this move (or the one already out, as it is). */
async function issueNext(ctx: RequestContext, battleId: string, userId: number, move: string): Promise<QRow | null> {
  const b = await need(ctx, battleId, userId);
  if (b.status !== "active") return null;
  if (b.currentSeq !== null) return (await qrow(ctx, battleId, b.currentSeq)) ?? null;
  const boss: Boss = J(b.bossJson, {});
  const mech = forBoss(boss);
  const intent: Intent | null = J(b.intentJson, null);
  if (boss.down) throw err("knocked_down", "You're down: continue or give up first.");
  if (lockedMoves(boss).includes(move) && !boss.finale?.armed) throw err("move_locked", `The ${boss.name || "boss"} has your ${titleCase(move)} pinned.`, { move });
  const cost = boss.finale?.armed ? 0 : moveCost(move, boss);
  if (b.focus < cost) throw err("not_enough_focus", `${titleCase(move)} needs ${cost} Focus.`, { focus: b.focus, cost });
  const tier = (mech?.forcedTier(intent) ?? null) || MOVES[move].tier;
  const riddle = !!(mech && mech.prefersRiddle(intent));
  // the phase's own questions first; when they run out, the other phase's (better than stopping to wait for the model)
  const q = await pickQuestion(ctx, battleId, b.phase, tier, b.difficulty, riddle) ?? await pickQuestion(ctx, battleId, b.phase === 1 ? 2 : 1, tier, b.difficulty, riddle);
  if (!q) return null;
  const options = shuffle([...J<BattleQuestion>(q.questionJson, {} as BattleQuestion).options]);
  let bossChanged = false;
  if (mech && mech.wantsIllusion(intent)) {
    const fake = illusionOption(options, await poolAnswers(ctx, battleId, q.seq));
    if (fake) { options.splice(Math.floor(Math.random() * (options.length + 1)), 0, fake); (boss.mech ??= {}).illusion = { seq: q.seq, option: fake }; bossChanged = true; }
  }
  const now = new Date();
  const finale = !!boss.finale?.armed;
  const seconds = finale ? Math.min(FINALE_SECONDS, timeLimit(boss, move)) : timeLimit(boss, move) + (boss.mount === "bird" && b.answered === 0 ? 3 : 0);
  if (finale) { boss.finale.seq = q.seq; bossChanged = true; }
  const took = await ctx.db.update(arenaQuestions).set({ status: "issued", optionsJson: JSON.stringify(options), issuedAt: iso(now), deadlineAt: iso(new Date(now.getTime() + seconds * 1000)), move })
    .where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, q.seq), eq(arenaQuestions.status, "queued"))).returning({ s: arenaQuestions.seq }).all();
  if (!took.length) return null;
  const libraryPending = !!boss.kit?.library_pending;
  if (libraryPending) { delete boss.kit.library_pending; bossChanged = true; }
  const claimed = await ctx.db.update(arenaBattles).set({ currentSeq: q.seq, focus: sql`${arenaBattles.focus} - ${cost}`, updatedAt: iso(now), ...(bossChanged ? { bossJson: JSON.stringify(boss) } : {}) })
    .where(and(eq(arenaBattles.id, battleId), sql`${arenaBattles.currentSeq} IS NULL`)).returning({ id: arenaBattles.id }).all();
  if (!claimed.length) {                                     // another tab issued one first: put this one back
    await ctx.db.update(arenaQuestions).set({ status: "queued", optionsJson: null, issuedAt: null, deadlineAt: null, move: null }).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, q.seq)));
    const now2 = await need(ctx, battleId, userId);
    return now2.currentSeq !== null ? (await qrow(ctx, battleId, now2.currentSeq)) ?? null : null;
  }
  if (libraryPending) await freeSpells(ctx, battleId, q.seq, boss, intent);
  return (await qrow(ctx, battleId, q.seq)) ?? null;
}

const retryable = () => new HttpError(503, "battle_generation_failed", "The boss is gathering its thoughts. Please try again in a moment.", "retry", { retryable: true });

/** {battle, question (null once the battle is over), previous (a timeout settled on the way)}. */
export async function nextQuestion(ctx: RequestContext, caller: Caller, player: Player, battleId: string, rawMove?: string | null) {
  const move = rawMove || DEFAULT_MOVE;
  if (!(move in MOVES)) throw new HttpError(400, "invalid_move", `Move must be one of: ${Object.keys(MOVES).join(", ")}.`);
  await need(ctx, battleId, player.id);
  const previous = await settleTimeout(ctx, battleId, player.id, player);
  let failures = 0;
  for (let i = 0; i <= MAX_BATCHES_PER_PHASE; i++) {
    let b = await need(ctx, battleId, player.id);
    if (b.status !== "active") return { battle: state(b), question: null, previous };
    const q = await issueNext(ctx, battleId, player.id, move);
    if (q) {
      b = await need(ctx, battleId, player.id);
      prefetch(ctx, caller, battleId, player.id);
      return { battle: state(b), question: publicQuestion(q, b), previous };
    }
    const failed = await fillOnce(ctx, caller, battleId, player.id, b.phase, attempts(b, b.phase) >= MAX_BATCHES_PER_PHASE);
    if (await poolSize(ctx, battleId, b.phase) > 0) continue;
    if (failed instanceof HttpError && failed.code !== "generation_failed") throw failed;
    if (failed || ++failures >= 2) throw retryable();
  }
  throw retryable();
}

// ── answering ────────────────────────────────────────────────────────────────────────────────────────────────
async function playerFor(ctx: RequestContext, userId: number): Promise<Player> {
  const u = await ctx.db.select({ tz: userTable.timezone }).from(userTable).where(eq(userTable.id, userId)).get();
  return { id: userId, tz: u?.tz ?? null };
}

/** An issued question past its deadline (+ grace) is a wrong answer. Every read of a battle comes through here. */
async function settleTimeout(ctx: RequestContext, battleId: string, userId: number, player?: Player) {
  const b = await row(ctx, battleId, userId);
  if (!b || b.status !== "active") return null;
  // knocked down and the CONTINUE countdown ran out (with a little grace): the fight is lost
  const down = J<Boss>(b.bossJson, {}).down;
  if (down && Date.now() > Date.parse(down.deadline) + CONTINUE_GRACE_MS) { await end(ctx, player ?? await playerFor(ctx, userId), battleId, "lost"); return null; }
  if (b.currentSeq === null) return null;
  const q = await qrow(ctx, battleId, b.currentSeq);
  if (!q || q.status !== "issued" || Date.now() <= Date.parse(q.deadlineAt!) + DEADLINE_GRACE_MS) return null;
  return resolve(ctx, player ?? await playerFor(ctx, userId), b, q, null, true);
}

export async function answer(ctx: RequestContext, player: Player, battleId: string, questionId: unknown, given: unknown) {
  const b = await need(ctx, battleId, player.id);
  const q = Number.isInteger(questionId) ? await qrow(ctx, battleId, questionId as number) : undefined;
  if (!q) throw new HttpError(404, "question_not_found", "That question isn't part of this battle.");
  if (q.status === "answered") return { ...J(q.outcomeJson, {}), ok: true, replayed: true, battle: state(b), rewards: null };
  if (b.status !== "active") throw err("battle_finished", "That battle is over.");
  if (q.status !== "issued" || b.currentSeq !== q.seq) throw err("question_not_current", "Ask for the next question before answering it.");
  if (J<Boss>(b.bossJson, {}).paused) throw err("battle_paused", "The fight is paused: resume it first.");
  const late = Date.now() > Date.parse(q.deadlineAt!) + DEADLINE_GRACE_MS;
  let picked: string | null = null;
  if (!late) {
    const removed: string[] = J(q.removedJson, []);
    picked = J<string[]>(q.optionsJson, []).filter((o) => !removed.includes(o)).find((o) => sameAnswer(o, given)) ?? null;
    if (picked === null) throw new HttpError(400, "invalid_answer", "Pick one of the answer options.");
  }
  const outcome = await resolve(ctx, player, b, q, picked, late);
  const after = await need(ctx, battleId, player.id);
  if (!outcome) {                                               // another tab answered it first
    const done = (await qrow(ctx, battleId, q.seq))!;
    return { ...J(done.outcomeJson, {}), ok: true, replayed: true, battle: state(after), rewards: null };
  }
  return { ...outcome, ok: true, replayed: false, battle: state(after), rewards: J(after.rewardsJson, null) };
}

/** Grade one issued question and resolve the turn both ways. Null when another request resolved it first. */
async function resolve(ctx: RequestContext, player: Player, b: Row, q: QRow, picked: string | null, timedOut: boolean) {
  const battleId = b.id;
  const question = J<BattleQuestion>(q.questionJson, {} as BattleQuestion);
  const boss: Boss = J(b.bossJson, {});
  const mods = (boss.mods ??= {});
  const relics = relicsOf(boss);
  const move = q.move || DEFAULT_MOVE;
  const intent: Intent = J(b.intentJson, null) ?? makeIntent("attack", boss, b.difficulty);
  const correct = picked !== null && !timedOut && sameAnswer(picked, question.correct_answer);
  const options: string[] = J(q.optionsJson, []);
  const correctOption = options.find((o) => sameAnswer(o, question.correct_answer)) ?? question.correct_answer;
  let combo = b.combo, phaseChanged = false, focus = b.focus, shield = b.shield;
  const focusCap = b.focusCap;
  let dealt = 0, taken = 0, absorbed = 0, healed = 0, drained = 0, lifesteal = 0, hitType: string | null = null;
  let gearBonus = 0, petStrike = 0, focusGained = 0, blocked = false, interrupted = false, aegis = false, revived = false, dodged = false;
  const weak = isWeakness(boss, question);
  const mech = forBoss(boss);
  const mstate = mech ? (boss.mech ??= {}) : {};
  const illusion = mstate.illusion ?? {};
  const limit = Math.max(1, questionLimit(boss, q));
  const turn = new Turn({
    difficulty: b.difficulty, boss, state: mstate, intent, move, correct, timedOut, turn: b.answered + 1, combo: correct ? b.combo + 1 : 0,
    conceptKey: mkey(question.concept), spentRatio: Math.min(1, Math.max(0, (Date.now() - Date.parse(q.issuedAt!)) / 1000 / limit)),
    illusionPicked: picked !== null && illusion.seq === q.seq && picked === illusion.option, poolConcepts: mech ? await poolConcepts(ctx, battleId) : [],
  });
  if (mech) mech.prepare(turn);
  const kstate: kits.KitState = boss.kit ?? kits.initKit(null);
  boss.kit = kstate;
  const kt = new kits.KitTurn(kstate.champion, b.difficulty, kstate, move, correct, turn.combo, DAMAGING_KINDS.includes(intent.kind) && !turn.skip, Math.random, q.seq);
  kt.hp = b.playerHp; kt.bossRatio = boss.max_hp ? boss.current_hp / boss.max_hp : 1;
  kits.prepare(kt);
  let riposte = 0;
  const rage = () => {
    if (boss.current_hp < boss.max_hp * (boss.rage_threshold ?? 0.4) && (boss.phase ?? 1) === 1) { boss.phase = 2; boss.rage = true; phaseChanged = true; }
  };
  // The creature's bane (tome.ts): these moves, answered right in a row, stagger it: x1.5 and it loses its turn.
  const baneHit = tome.trackBane(boss, move, correct);
  const finaleTurn = !!boss.finale?.armed && boss.finale.seq === q.seq;
  let comboSpecial = false, finisher = false, recovered = 0, points = 0;
  const score = (boss.score ??= { points: 0, speed: 0, specials: 0, finisher: 0, continues: 0, best_level: 1, total: 0 });
  if (correct) {
    combo += 1 + kt.comboBonus;
    const hit = playerHit(boss, combo, kt.comboExtra);
    dealt = hit.damage; hitType = hit.hit_type;
    if (weak) dealt *= relics.has("scholar_lens") ? 3 : 2;
    const moveMult = move === "jab" && kt.jabMult ? kt.jabMult : move === "heavy" && kt.heavyMult ? kt.heavyMult
      : move === "strike" && kt.strikeMult ? kt.strikeMult : MOVES[move].mult;
    dealt = Math.trunc(dealt * moveMult * turn.mult * kt.mult * effects.weakenMult(boss));
    // the combo: each level past x1 a little harder; at x5, a combo special every third right answer
    dealt = Math.trunc(dealt * (1 + COMBO_DAMAGE_STEP * (comboLevel(combo) - 1)));
    if (isComboSpecial(combo)) { comboSpecial = true; dealt = Math.trunc(dealt * COMBO_SPECIAL_MULT); }
    if (baneHit) dealt = Math.trunc(dealt * tome.BANE_MULT);
    if (boss.mount === "dragon" && move === "heavy") dealt = Math.trunc(dealt * 1.05);
    if (dealt > 0) {
      const gear = boss.gear ?? {};
      const weaponBonus = Math.round(dealt * Number(gear.damage_pct ?? 0));
      petStrike = combo >= 3 ? Number(gear.strike ?? 0) : 0;
      gearBonus = weaponBonus + petStrike;
      dealt += gearBonus;
    }
    if (shield && dealt && !weak && !kt.ignoreShield) { absorbed = Math.min(shield, dealt); shield -= absorbed; dealt -= absorbed; }
    // the final move lands: it ends the fight, whatever was left (the shield too)
    if (finaleTurn) { finisher = true; shield = 0; absorbed = 0; dealt = Math.max(dealt, boss.current_hp); }
    boss.current_hp = Math.max(0, boss.current_hp - dealt);
    // the score: the tier's points, up to half again for speed, times the combo's level
    const tierPts = POINTS[questionTier(question.difficulty, b.difficulty)] ?? POINTS.medium;
    const quick = Math.round(tierPts * 0.5 * (1 - turn.spentRatio));
    points = Math.round((tierPts + quick) * comboLevel(combo));
    score.points += points; score.speed += quick;
    score.best_level = Math.max(score.best_level, comboLevel(combo));
    if (comboSpecial) score.specials += 1;
    if (finisher) score.finisher = FINISHER_POINTS;
    boss.total_damage_taken = (boss.total_damage_taken ?? 0) + dealt;
    boss.rounds_fought = (boss.rounds_fought ?? 0) + 1;
    rage();
    const gain = 1 + (move === "guard" ? 1 : 0) + (move === "jab" ? (relics.has("quill") ? 2 : 1) : 0);
    focusGained = Math.min(focusCap, focus + gain) - focus;
    focus += focusGained;
    if ((relics.has("vampiric_tome") && combo % VAMPIRIC_COMBO === 0) || kits.vampiric(kstate, combo)) lifesteal = 1;
  } else {
    combo = 0;
    if (finaleTurn) {
      recovered = Math.max(1, Math.ceil(boss.max_hp * FINALE_RECOVER_PCT));
      boss.current_hp = Math.min(boss.max_hp, boss.current_hp + recovered);
    }
  }
  // the final move is armed once (each time) the boss drops low; spent either way once it is tried
  if (finaleTurn) boss.finale = { armed: false, tried: Number(boss.finale?.tried ?? 0) + 1 };
  else if (boss.current_hp > 0 && boss.current_hp <= boss.max_hp * FINALE_PCT && !boss.finale?.armed && !(correct && recovered)) boss.finale = { ...(boss.finale ?? {}), armed: true };
  let attackName: string | null = null;
  let taunt: string;
  if (boss.current_hp > 0) {
    const kind = intent.kind;
    if (turn.skip || baneHit) { /* takes aim / stunned / staggered by its bane */ }
    else if (DAMAGING_KINDS.includes(kind)) {
      const value = Number(intent.value ?? 0) + turn.bossBonus;
      attackName = intent.name;
      if (turn.dodge) { taken = 0; dodged = true; }
      else if (kt.block || (correct && move === "guard" && !kt.guardHalves)) { taken = 0; blocked = true; }
      else if (correct && move === "guard" && kt.guardHalves) taken = Math.floor(value / 2);   // Brak's Reckless
      else {
        taken = !correct || turn.noHalve ? value : Math.floor(value / kt.divisor);
        if (kt.halveAfter) taken = Math.floor(taken / 2);
        if (kt.steady) taken = Math.floor(taken * 0.75);                        // your hero's Steady
        if (kt.forgive && taken > 0) taken = 0;                                  // your hero's Thick Skin
      }
      if (taken > 0 && kt.dodge) { taken = 0; dodged = true; } else { kt.dodge = false; kt.vanished = false; }
      if (taken > 0 && boss.mount === "beast" && Math.random() < 0.05) { taken = 0; dodged = true; }
      if (taken > 0 && Math.random() < Number(boss.gear?.guard_pct ?? 0)) taken -= 1;            // forged outfit and head piece
      if (kt.riposte && blocked && correct && move === "guard") {
        riposte = Math.trunc(playerHit(boss, combo).damage * kt.riposte);
        const soak = weak ? 0 : Math.min(shield, riposte);
        shield -= soak; riposte -= soak; dealt += riposte;
        boss.current_hp = Math.max(0, boss.current_hp - riposte);
        boss.total_damage_taken = (boss.total_damage_taken ?? 0) + riposte;
        rage();
      }
    } else if (kind === "shield") shield += Number(intent.value ?? 0);
    else if (kind === "drain" && !correct) { drained = focus; focus = 0; }
    else if (kind === "heal") {
      if (correct && INTERRUPTING.includes(move)) interrupted = true;
      else {
        const amount = Number(intent.amount ?? Math.round((boss.max_hp * Number(intent.value ?? 0)) / 100));
        healed = Math.max(0, Math.min(amount, boss.max_hp - boss.current_hp));
        boss.current_hp += healed;
      }
    }
    if (!correct && taken > 0 && relics.has("aegis") && !mods.aegis_used) { taken = 0; aegis = true; mods.aegis_used = true; }
    boss.total_damage_dealt = (boss.total_damage_dealt ?? 0) + taken;
    taunt = correct ? bossTaunt(boss, phaseChanged ? "phase_change" : "hit") : bossTaunt(boss, "miss");
  } else taunt = bossTaunt(boss, "defeat");
  let mechHeal = 0, mechDamage = 0;
  if (mech) {
    turn.dealt = dealt;
    mech.settle(turn);
    if (boss.current_hp > 0) {
      mechHeal = Math.max(0, Math.min(turn.bossHeal, boss.max_hp - boss.current_hp));
      boss.current_hp += mechHeal;
      shield += turn.shield;
      if (turn.newWeakness) boss.weakness = turn.newWeakness;
      mechDamage = turn.playerDot;
    }
    focus = Math.max(0, Math.min(focusCap, focus + turn.focusDelta));
    delete mstate.illusion;
  }
  if (!(boss.current_hp > 0 && DAMAGING_KINDS.includes(intent.kind))) { kt.dodge = false; kt.vanished = false; }
  kits.settle(kt);
  focus = Math.max(0, Math.min(focusCap, focus + kt.focusDelta + kt.refund));
  let meterGained = kits.charge(kstate, correct, combo);
  if (correct && comboLevel(combo) > 1) {
    const extra = Math.min(kits.METER_MAX - (kstate.meter || 0), Math.round(meterGained * COMBO_METER_STEP * (comboLevel(combo) - 1)));
    kstate.meter = (kstate.meter || 0) + extra; meterGained += extra;
  }
  // the effects on the champion tick (burns, poisons...) and count down; then the blow's own effect lands - only on a
  // miss that wasn't dodged or absorbed, and only while the boss still stands
  const ticked = effects.tick(boss);
  const carried = effects.effectById((intent as Intent & { effect?: { id: string } }).effect?.id);
  let landed: { id: string; name: string; kind: string; text: string } | null = null, sapped = 0, effectDrained = 0;
  if (carried && !correct && !dodged && !aegis && !turn.skip && !baneHit && boss.current_hp > 0) {
    const r = effects.land(boss, carried);
    landed = { id: carried.id, name: carried.name, kind: carried.kind, text: carried.text };
    sapped = r.sapped; effectDrained = r.drained;
    focus = Math.max(0, focus - effectDrained);
  }
  let playerHp = Math.max(0, Math.min(b.playerMaxHp, b.playerHp + lifesteal + (mech ? turn.hearts : 0)) - taken - mechDamage - kt.selfDamage - ticked.damage);
  // what this turn did, for mastery challenges (counted at the end of the fight)
  if (riposte > 0) kits.bumpStat(kstate, "riposte");
  if (correct && move === "jab") kits.bumpStat(kstate, "right_jab");
  if (move === "heavy") kits.bumpStat(kstate, "heavy");
  if (kt.halveAfter && taken > 0) kits.bumpStat(kstate, "wall_blow");
  if (correct && combo === 8) kits.bumpStat(kstate, "combo8");
  if (correct && kt.events.some((e) => e.type === "ultimate_hit") && kstate.champion === "brak" && combo >= 6) kits.bumpStat(kstate, "rush6");
  if (dodged && !kt.vanished && kstate.champion === "vex") kits.bumpStat(kstate, "slip");
  if (blocked && correct) kits.bumpStat(kstate, "right_block");
  if (boss.current_hp <= 0 && kt.events.some((e) => e.type === "ultimate_hit")) kits.bumpStat(kstate, "ult_ko");
  if (playerHp <= 0 && relics.has("phoenix_ash") && !mods.phoenix_used) { playerHp = Math.min(PHOENIX_HEARTS, b.playerMaxHp); revived = true; mods.phoenix_used = true; }
  playerHp += kits.afterBlow(kstate, playerHp, b.playerMaxHp, kt);               // your hero's Second Wind
  const answered = b.answered + 1;
  const continues = Number(boss.continues ?? 0);
  const knockedDown = playerHp <= 0 && boss.current_hp > 0 && answered < MAX_ANSWERS && continues < MAX_CONTINUES;
  if (knockedDown) boss.down = { at: iso(), deadline: iso(new Date(Date.now() + CONTINUE_SECONDS * 1000)) };
  score.total = scoreTotal(boss, boss.current_hp <= 0 ? playerHp : 0);
  const over = !knockedDown && (boss.current_hp <= 0 || playerHp <= 0 || answered >= MAX_ANSWERS);
  const nextIntent = over ? null : nextIntentFor(boss, b.difficulty, answered + 1);
  const now = new Date();
  const spent = Math.min((now.getTime() - Date.parse(q.issuedAt!)) / 1000, questionLimit(boss, q));
  const outcome = {
    question_id: q.seq, correct, timed_out: timedOut, answer: picked, correct_answer: correctOption, explanation: question.explanation || null,
    move, tier: questionTier(question.difficulty, b.difficulty), damage_dealt: dealt, hit_type: hitType, weakness: weak && correct,
    damage_taken: taken, attack_name: attackName, taunt, phase_changed: phaseChanged, combo, gear_bonus: gearBonus, pet_strike: petStrike,
    intent, next_intent: nextIntent, blocked, interrupted, shield_absorbed: absorbed, boss_healed: healed + recovered, focus, focus_gained: focusGained,
    combo_level: comboLevel(combo), combo_special: comboSpecial, points, score: score.total, finale_armed: !!boss.finale?.armed,
    finisher: finisher ? finisherFor(kstate) : null, finale_missed: finaleTurn && !correct, knocked_down: knockedDown,
    focus_drained: drained, aegis, revived, lifesteal, dodged, riposte, kit_meter_gained: meterGained,
    bane: baneHit ? { landed: true, found: false } : null,
    kit: { events: kt.events, refund: kt.refund, hud: kits.kitHud(kstate) },
    effects: { landed, ticked: ticked.ticked, expired: ticked.expired, damage: ticked.damage, sapped, drained: effectDrained, active: effects.hud(boss) },
    mechanic: mech ? { id: mech.id, events: turn.events, boss_healed: mechHeal, damage: mechDamage, hearts: turn.hearts, focus: turn.focusDelta,
                       shield: boss.current_hp > 0 ? turn.shield : 0, illusion_picked: turn.illusionPicked, hud: mechanicHud(boss, b.difficulty) } : null,
  };
  const claimed = await ctx.db.update(arenaQuestions).set({ status: "answered", answer: picked, correct: correct ? 1 : 0, timedOut: timedOut ? 1 : 0, answeredAt: iso(now), outcomeJson: JSON.stringify(outcome) })
    .where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, q.seq), eq(arenaQuestions.status, "issued"))).returning({ s: arenaQuestions.seq }).all();
  if (!claimed.length) return null;
  await ctx.db.update(arenaBattles).set({
    bossJson: JSON.stringify(boss), bossHp: boss.current_hp, playerHp, phase: boss.phase ?? 1, combo, maxCombo: Math.max(b.maxCombo, combo), answered,
    correct: sql`${arenaBattles.correct} + ${correct ? 1 : 0}`, activeMs: sql`${arenaBattles.activeMs} + ${Math.trunc(spent * 1000)}`, currentSeq: null,
    focus, shield, intentJson: nextIntent ? JSON.stringify(nextIntent) : b.intentJson, updatedAt: iso(now),
  }).where(eq(arenaBattles.id, battleId));
  await recordMastery(ctx, b.userId, b.docHash, question.concept, correct, { source: "arena", question: { question: question.question, correct_answer: correctOption, explanation: question.explanation } });
  if (baneHit) {
    // landed before it was written in: the player worked it out (paid once, with an achievement check)
    const { found } = await tome.baneLanded(ctx, b.userId, String(boss.species ?? ""));
    await scrolls.scrollEvent(ctx, b.userId, ["bane_landed", `bane_as:${kstate.champion}`]);
    if (found) {
      outcome.bane = { landed: true, found: true };
      const newly = await checkAchievements(ctx, b.userId);
      if (newly.length) (outcome as Record<string, unknown>).new_achievements = newly;
      await ctx.db.update(arenaQuestions).set({ outcomeJson: JSON.stringify(outcome) })
        .where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, q.seq)));
    }
  }
  if (boss.current_hp <= 0) await end(ctx, player, battleId, "won");
  else if (!knockedDown && (playerHp <= 0 || answered >= MAX_ANSWERS)) await end(ctx, player, battleId, "lost");
  return outcome;
}

// ── ending ───────────────────────────────────────────────────────────────────────────────────────────────────
type RunEnd = (ctx: RequestContext, player: Player, b: Row, status: string) => Promise<unknown>;
let onRunBattleEnd: RunEnd | null = null;
/** The expedition takes over the end of its battles (expedition.ts registers itself). */
export function setRunBattleEnd(fn: RunEnd) { onRunBattleEnd = fn; }
let onGauntletBattleEnd: RunEnd | null = null;
/** Boss Rush / Survival hear about the end of their fights (gauntlet.ts registers itself); the fight pays as usual. */
export function setGauntletBattleEnd(fn: RunEnd) { onGauntletBattleEnd = fn; }

async function missed(ctx: RequestContext, battleId: string) {
  const rows = await ctx.db.select().from(arenaQuestions).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.status, "answered"), eq(arenaQuestions.correct, 0))).orderBy(asc(arenaQuestions.seq)).all();
  return rows.map((r) => {
    const q = J<BattleQuestion>(r.questionJson, {} as BattleQuestion);
    const right = J<string[]>(r.optionsJson, []).find((o) => sameAnswer(o, q.correct_answer)) ?? q.correct_answer;
    return { concept: q.concept || null, question: q.question, correct_answer: right, explanation: q.explanation || null };
  });
}

/** The champion that fought earns XP (once per battle); levels 3 / 6 / 10 grant its mastery skins. */
async function championXp(ctx: RequestContext, userId: number, b: Row, won: boolean) {
  const cid = (J<Boss>(b.bossJson, {}).kit?.champion ?? "kaien") as string;
  const xp = kits.battleXp(b.correct, won);
  const t = iso();
  await ctx.db.insert(championProgress).values({ userId, championId: cid, updatedAt: t }).onConflictDoNothing();
  const r = (await ctx.db.select().from(championProgress).where(and(eq(championProgress.userId, userId), eq(championProgress.championId, cid))).get())!;
  const total = r.xp + Math.max(0, xp);
  const level = Math.max(r.level, kits.levelFor(total));
  await ctx.db.update(championProgress).set({ xp: total, level, battles: r.battles + 1, wins: r.wins + (won ? 1 : 0), updatedAt: t })
    .where(and(eq(championProgress.userId, userId), eq(championProgress.championId, cid)));
  const unlocked = kits.unlockedBetween(cid, r.level, level).map((u) => u.id);
  if (unlocked.length) await modifyAvatar(ctx, userId, (_e, owned) => { for (const id of unlocked) if (!owned.includes(id)) owned.push(id); });
  return { id: cid, xp_gained: xp, xp: total, level, leveled_up: level > r.level, next_level_xp: kits.nextLevelXp(level), unlocked };
}

/** Your hero earned XP for a fight fought as your hero (full battle XP, +10% with the Scholar perk). */
async function heroXp(ctx: RequestContext, userId: number, b: Row, won: boolean) {
  const xp = Math.round(kits.battleXp(b.correct, won) * (await build.xpBoost(ctx, userId, false)));
  const r = await build.addXp(ctx, userId, xp);
  return { id: build.HERO_ID, xp_gained: xp, xp: r?.xp ?? 0, level: r?.level ?? 1, leveled_up: !!r?.leveled_up, next_level_xp: r?.next_level_xp ?? null, unlocked: [] as string[] };
}

async function recordScore(ctx: RequestContext, b: Row, grade: string, accuracy: number, seconds: number, now: string) {
  const u = await ctx.db.select({ name: userTable.username }).from(userTable).where(eq(userTable.id, b.userId)).get();
  await ctx.db.insert(arenaScores).values({ battleId: b.id, boardKey: b.boardKey, userId: b.userId, username: u?.name || String(b.userId).slice(0, 8), topic: b.topic,
    topicKey: normTopic(b.topic), difficulty: b.difficulty, docHash: b.docHash, grade, accuracy, timeSeconds: seconds, createdAt: now }).onConflictDoNothing();
  const best = await ctx.db.insert(arenaPersonalBests).values({ userId: b.userId, boardKey: b.boardKey, battleId: b.id, grade, accuracy, timeSeconds: seconds, updatedAt: now })
    .onConflictDoUpdate({
      target: [arenaPersonalBests.userId, arenaPersonalBests.boardKey],
      set: { battleId: b.id, grade, accuracy, timeSeconds: seconds, updatedAt: now },
      setWhere: sql`excluded.accuracy > ${arenaPersonalBests.accuracy} OR (excluded.accuracy = ${arenaPersonalBests.accuracy} AND excluded.time_seconds < ${arenaPersonalBests.timeSeconds})`,
    }).returning({ id: arenaPersonalBests.battleId }).all();
  return best.length === 1;
}

/** Finish a battle ONCE (compare-and-set): rewards, leaderboard row, personal best and champion XP. */
export async function end(ctx: RequestContext, player: Player, battleId: string, status: "won" | "lost") {
  const b = await need(ctx, battleId, player.id);
  if (b.status !== "active") return null;
  const now = iso();
  const won = await ctx.db.update(arenaBattles).set({ status, finishedAt: now, updatedAt: now, currentSeq: null })
    .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.status, "active"))).returning({ id: arenaBattles.id }).all();
  if (!won.length) return null;
  const accuracy = b.answered ? Math.round((100 * b.correct) / b.answered) : 0;
  const seconds = Math.max(1, Math.round(b.activeMs / 1000));
  const grade = gradeFor(accuracy);
  const paid: Record<string, unknown> = { arena_round_complete: null, boss_defeat: null };
  const fighterKit = J<Boss>(b.bossJson, {}).kit as kits.KitState | undefined;
  const asHero = fighterKit?.champion === build.HERO_ID;
  const endBoss = J<Boss>(b.bossJson, {});
  const total = scoreTotal(endBoss, status === "won" ? b.playerHp : 0);
  const sc = endBoss.score ?? {};
  const scoreCard = {
    points: Number(sc.points ?? 0), speed: Number(sc.speed ?? 0), finisher: Number(sc.finisher ?? 0),
    hearts: status === "won" ? Math.max(0, b.playerHp) * HEART_POINTS : 0, best_combo: b.maxCombo, best_level: Number(sc.best_level ?? 1),
    specials: Number(sc.specials ?? 0), continues: Number(endBoss.continues ?? 0), total, rank: scoreRank(total, b.answered),
  };
  const result: Record<string, unknown> = { grade, accuracy, time_seconds: seconds, new_personal_best: false, missed: await missed(ctx, battleId), score: scoreCard,
    champion: asHero ? await heroXp(ctx, player.id, b, status === "won") : await championXp(ctx, player.id, b, status === "won") };
  // the Bestiary: the record, first defeat, mastery, a newly opened tier (every mode counts, runs too)
  const fought = String(J<Boss>(b.bossJson, {}).species ?? "");
  const fight = await tome.recordFight(ctx, player.id, {
    // flawless (no heart lost) counts toward gold mastery on hard or nightmare only
    species: fought, won: status === "won", flawless: b.playerHp >= b.playerMaxHp && (b.difficulty === "hard" || b.difficulty === "nightmare"),
    nightmare: b.difficulty === "nightmare", seconds, accuracy,
  });
  result.bestiary = fight;
  // champion mastery: this fight's challenges (Ripostes, right Jabs, wins on hard...) for the champion who fought it
  const kitDone = J<Boss>(b.bossJson, {}).kit as kits.KitState | undefined;
  const finished = await mastery.recordFight(ctx, player.id, String(kitDone?.champion ?? "kaien"), {
    won: status === "won", correct: b.correct, difficulty: b.difficulty, flawless: b.playerHp >= b.playerMaxHp, seconds,
    heartsLeft: b.playerHp, stats: kitDone?.stats ?? {}, tiersFinished: fight?.tiers_finished.length ?? 0,
  });
  if (finished.length) result.challenges_done = finished;
  // the forge: everything worn earns XP; a Bestiary win drops materials from the creature's land
  const wornIds: string[] = J<Boss>(b.bossJson, {}).gear?.worn ?? [];
  result.forge = {
    ...(await forge.fightXp(ctx, player.id, wornIds, b.correct, status === "won")),
    materials: await forge.dropMaterials(ctx, player.id, fought, b.difficulty, status === "won", fight?.tiers_finished.length ?? 0),
  };
  // a finished Bestiary tier brings a champion (its ceremony plays on screen, from the roster)
  if (fight?.tiers_finished.length) {
    const joined = await roster.grantForTiers(ctx, player.id, fight.tiers_finished);
    if (joined.length) result.champions_unlocked = joined;
  }
  if (status === "won") {
    // the quest board: hunts, hard-fight trials, the champion's story
    const fighter = String(J<Boss>(b.bossJson, {}).kit?.champion ?? "kaien");
    await scrolls.scrollEvent(ctx, player.id, scrolls.fightEvents({ species: fought, difficulty: b.difficulty, champion: fighter }));
    const newly = await checkAchievements(ctx, player.id);
    if (newly.length) result.new_achievements = newly;
  }
  // the run's module registers its hook when loaded; a route that only loaded this one loads it now
  if (b.runId && !onRunBattleEnd) await import("./expedition");
  if (b.gauntletId && !onGauntletBattleEnd) await import("./gauntlet");
  if (b.runId) {
    if (onRunBattleEnd) result.run = await onRunBattleEnd(ctx, player, { ...b, status }, status);
  } else {
    const ratio = accuracy / 100;
    if (b.answered >= ROUND_SIZE) {
      paid.arena_round_complete = await award(ctx, player, "arena_round_complete", { accuracy: ratio, difficulty: b.phase === 2 ? 1.5 : 1.2, combo: Math.max(b.maxCombo, 1), sourceId: battleId });
    }
    if (status === "won") {
      paid.boss_defeat = await award(ctx, player, "boss_defeat", { accuracy: ratio, difficulty: BOSS_DEFEAT_DIFFICULTY[b.difficulty] ?? 1.2, combo: Math.max(b.maxCombo, 1), sourceId: battleId });
      result.new_personal_best = await recordScore(ctx, b, grade, accuracy, seconds, now);
      // the taunt's promise: +25% of what the win paid, once
      const won = paid.boss_defeat as { xp_gained?: number; coins_gained?: number } | null;
      // your hero's Lucky Coin perk: +10% of the win's coins
      if (asHero && fighterKit?.perks?.includes("lucky_coin") && won?.coins_gained) {
        const extra = Math.max(1, Math.round(Number(won.coins_gained) * 0.1));
        const res = await recordRewardEvent(ctx, player.id, "lucky_coin", 0, extra, battleId, `u${player.id}:lucky:${battleId}`);
        if (res.applied) result.lucky_coin = extra;
      }
      if (J<Boss>(b.bossJson, {}).mods?.taunted && won) {
        const bonus = { xp: Math.round(Number(won.xp_gained ?? 0) * TAUNT_BONUS), coins: Math.round(Number(won.coins_gained ?? 0) * TAUNT_BONUS) };
        const res = await recordRewardEvent(ctx, player.id, "taunt_bonus", bonus.xp, bonus.coins, battleId, `u${player.id}:taunt:${battleId}`);
        if (res.applied && (bonus.xp || bonus.coins)) result.taunt_bonus = bonus;
      }
    }
  }
  if (b.gauntletId && onGauntletBattleEnd) result.gauntlet = await onGauntletBattleEnd(ctx, player, { ...b, status, resultJson: JSON.stringify(result) }, status);
  // two worlds, Stage 5: the weekly invasion repelled (its bonus, once a week)
  if (status === "won" && b.mode === "invasion") result.invasion = await (await import("./invasion")).repel(ctx, player);
  // two worlds, Stage 7: a season's limited boss beaten (its bonus, once a season)
  if (status === "won" && b.mode === "season") {
    const s = (await import("@/lib/game/seasons")).seasonById(String(J<Boss>(b.bossJson, {}).season ?? ""));
    if (s) result.season = await (await import("./season")).seasonWon(ctx, player, s);
  }
  await ctx.db.update(arenaBattles).set({ rewardsJson: JSON.stringify(paid), resultJson: JSON.stringify(result) }).where(eq(arenaBattles.id, battleId));
  return paid;
}

/**
 * CONTINUE after a knock-down: a health potion from the bag (free) or coins (the price doubles each time), up to 3 a
 * fight. You come back with full hearts and no effects on you; the boss keeps its HP. Too late (the countdown and its
 * grace are over) and the fight is lost.
 */
export async function continueBattle(ctx: RequestContext, player: Player, battleId: string, by: unknown) {
  if (by !== "potion" && by !== "coins") throw new HttpError(400, "invalid_input", "Continue with a potion or with coins.");
  await need(ctx, battleId, player.id);
  await settleTimeout(ctx, battleId, player.id, player);
  const b = await need(ctx, battleId, player.id);
  if (b.status !== "active") throw err("battle_finished", "That battle is over.");
  const boss: Boss = J(b.bossJson, {});
  if (!boss.down) throw err("not_down", "You're still standing.");
  const used = Number(boss.continues ?? 0);
  if (used >= MAX_CONTINUES) throw err("no_continues", `Only ${MAX_CONTINUES} continues a fight.`);
  if (by === "potion") {
    if (!await consume(ctx, player.id, "heal")) throw err("no_stock", "You don't have a health potion.");
  } else {
    const cost = continueCoins(used);
    const paid = await recordRewardEvent(ctx, player.id, "arena_continue", 0, -cost, battleId, `u${player.id}:continue:${battleId}:${used}`);
    if (!paid.applied) throw new HttpError(402, "not_enough_coins", `Continuing costs ${cost} coins.`, null, { cost });
  }
  delete boss.down;
  boss.continues = used + 1;
  boss.player_effects = [];
  const done = await ctx.db.update(arenaBattles).set({ bossJson: JSON.stringify(boss), playerHp: b.playerMaxHp, currentSeq: null, updatedAt: iso() })
    .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.updatedAt, b.updatedAt))).returning({ id: arenaBattles.id }).all();
  if (!done.length) throw err("battle_changed", "The battle changed. Please try again.");
  return { ok: true, continued: { by, continues: used + 1 }, battle: state(await need(ctx, battleId, player.id)), stock: await stock(ctx, player.id) };
}

export async function forfeit(ctx: RequestContext, player: Player, battleId: string) {
  await need(ctx, battleId, player.id);
  await settleTimeout(ctx, battleId, player.id, player);
  await end(ctx, player, battleId, "lost");
  const b = await need(ctx, battleId, player.id);
  return { ok: true, battle: state(b), rewards: J(b.rewardsJson, null) };
}

// ── items, spells, the ultimate ──────────────────────────────────────────────────────────────────────────────
export async function stock(ctx: RequestContext, userId: number) {
  const inv = await inventory(ctx, userId);
  const buffs = await activeBuffs(ctx, userId);
  return { heal: (inv[HEAL_ITEM] ?? 0) + Number(buffs.heal_1?.count ?? 0), fifty_fifty: (inv[FIFTY_ITEM] ?? 0) + Number(buffs.fifty_fifty?.count ?? 0) };
}

/** Take ONE charge the player really holds: an activated charge first, then the inventory. */
async function consume(ctx: RequestContext, userId: number, item: "heal" | "fifty_fifty") {
  if (await consumeCharge(ctx, userId, item === "heal" ? "heal_1" : "fifty_fifty") >= 0) return true;
  return consumeInventory(ctx, userId, item === "heal" ? HEAL_ITEM : FIFTY_ITEM);
}

export async function useItem(ctx: RequestContext, player: Player, battleId: string, item: unknown) {
  if (item !== "heal" && item !== "fifty_fifty") throw new HttpError(400, "invalid_item", "Unknown item.");
  await need(ctx, battleId, player.id);
  await settleTimeout(ctx, battleId, player.id, player);
  let b = await need(ctx, battleId, player.id);
  if (b.status !== "active") throw err("battle_finished", "That battle is over.");
  if (effects.cursed(J<Boss>(b.bossJson, {}))) throw err("cursed", "You are cursed: no potions for now.");
  let question = null;
  if (item === "heal") {
    if (b.playerHp >= b.playerMaxHp) throw err("hp_full", "Your hearts are already full.");
    if (!await consume(ctx, player.id, "heal")) throw err("no_stock", "You don't have a health potion.");
    await ctx.db.update(arenaBattles).set({ playerHp: sql`MIN(${arenaBattles.playerHp} + 1, ${arenaBattles.playerMaxHp})`, healsUsed: sql`${arenaBattles.healsUsed} + 1`, updatedAt: iso() }).where(eq(arenaBattles.id, battleId));
  } else {
    const q = b.currentSeq !== null ? await qrow(ctx, battleId, b.currentSeq) : undefined;
    if (!q || q.status !== "issued") throw err("no_question", "There is no question to use that on.");
    if (q.removedJson) throw err("already_used", "You already used 50/50 on this question.");
    const bossNow: Boss = J(b.bossJson, {});
    if (bossNow.mods?.insight?.fifty) {                                // Insight's free 50/50 goes first
      bossNow.mods.insight.fifty = false;
      await ctx.db.update(arenaBattles).set({ bossJson: JSON.stringify(bossNow) }).where(eq(arenaBattles.id, battleId));
    } else if (!await consume(ctx, player.id, "fifty_fifty")) throw err("no_stock", "You don't have a 50/50 charge.");
    await ctx.db.update(arenaQuestions).set({ removedJson: JSON.stringify(twoWrong(q, J(b.bossJson, {}))) }).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, q.seq)));
    await ctx.db.update(arenaBattles).set({ fiftyUsed: sql`${arenaBattles.fiftyUsed} + 1`, updatedAt: iso() }).where(eq(arenaBattles.id, battleId));
  }
  b = await need(ctx, battleId, player.id);
  if (item === "fifty_fifty") question = publicQuestion((await qrow(ctx, battleId, b.currentSeq!))!, b);
  return { ok: true, item, battle: state(b), question, stock: await stock(ctx, player.id) };
}

export async function useUltimate(ctx: RequestContext, player: Player, battleId: string) {
  await need(ctx, battleId, player.id);
  await settleTimeout(ctx, battleId, player.id, player);
  let b = await need(ctx, battleId, player.id);
  if (b.status !== "active") throw err("battle_finished", "That battle is over.");
  const boss: Boss = J(b.bossJson, {});
  const ks: kits.KitState = (boss.kit ??= kits.initKit(null));
  let fx;
  try { fx = kits.activate(ks); } catch (e) {
    if (e instanceof kits.NotReady) throw err("ultimate_not_ready", "Your ultimate is still charging.", { meter: ks.meter ?? 0 });
    throw err("ultimate_active", "Your ultimate is already in play.");
  }
  const hearts = Math.max(0, Math.min(fx.hearts, b.playerMaxHp - b.playerHp));
  kits.bumpStat(ks, "ultimate");
  const q = b.currentSeq !== null ? await qrow(ctx, battleId, b.currentSeq) : undefined;
  const open = !!q && q.status === "issued" && Date.now() <= Date.parse(q.deadlineAt!);
  if ((fx.insight || fx.timewarp) && !open) ks.library_pending = true;
  const focusUp = Math.max(0, Math.min(fx.focus ?? 0, b.focusCap - b.focus));                // Rally's +1 Focus
  const done = await ctx.db.update(arenaBattles).set({ bossJson: JSON.stringify(boss), playerHp: sql`${arenaBattles.playerHp} + ${hearts}`, focus: sql`${arenaBattles.focus} + ${focusUp}`, updatedAt: iso() })
    .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.updatedAt, b.updatedAt))).returning({ id: arenaBattles.id }).all();
  if (!done.length) throw err("ultimate_active", "Your ultimate is already in play.");
  if ((fx.insight || fx.timewarp) && open) await freeSpells(ctx, battleId, q!.seq, boss, J(b.intentJson, null));
  b = await need(ctx, battleId, player.id);
  return { ok: true, ultimate: { ...fx, hearts }, battle: state(b), question: open ? publicQuestion((await qrow(ctx, battleId, q!.seq))!, b) : null };
}

// ── the pause menu (the two worlds, Stage 3): Esc in the Hero world pauses a fight ───────────────────────────────
export const MAX_PAUSES = 3;
/** While paused the question's clock is parked this far ahead (a pause left open longer runs out after all). */
const PAUSE_HOLD_MS = 10 * 60 * 1000;

/**
 * Pause the fight while a question is open: its clock stops (the seconds left are kept) and it can't be answered
 * until the fight resumes. Three pauses a fight. Nothing open: nothing to stop (the turn waits for you anyway).
 */
export async function pauseBattle(ctx: RequestContext, player: Player, battleId: string) {
  await need(ctx, battleId, player.id);
  await settleTimeout(ctx, battleId, player.id, player);
  for (let i = 0; i < 3; i++) {
    const b = await need(ctx, battleId, player.id);
    if (b.status !== "active") throw err("battle_finished", "That battle is over.");
    const boss: Boss = J(b.bossJson, {});
    if (boss.paused) return { ok: true, paused: true, battle: state(b) };
    const q = b.currentSeq !== null ? await qrow(ctx, battleId, b.currentSeq) : undefined;
    const left = q && q.status === "issued" ? Date.parse(q.deadlineAt!) - Date.now() : 0;
    if (!q || q.status !== "issued" || left <= 0) return { ok: true, paused: false, battle: state(b) };
    if (Number(boss.pauses ?? 0) >= MAX_PAUSES) throw err("no_pauses", `You've used your ${MAX_PAUSES} pauses this fight: the clock keeps running.`);
    boss.paused = { at: iso(), seq: q.seq, left_ms: left };
    boss.pauses = Number(boss.pauses ?? 0) + 1;
    const done = await ctx.db.update(arenaBattles).set({ bossJson: JSON.stringify(boss), updatedAt: iso() })
      .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.bossJson, b.bossJson))).returning({ id: arenaBattles.id }).all();
    if (!done.length) continue;
    await ctx.db.update(arenaQuestions).set({ deadlineAt: iso(new Date(Date.now() + PAUSE_HOLD_MS)) }).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, q.seq)));
    return { ok: true, paused: true, battle: state(await need(ctx, battleId, player.id)) };
  }
  throw err("battle_busy", "The fight changed meanwhile. Try again.");
}

/** Resume: the question's clock picks up with the seconds it had left, and its options are dealt again. */
export async function resumeBattle(ctx: RequestContext, player: Player, battleId: string) {
  for (let i = 0; i < 3; i++) {
    const b = await need(ctx, battleId, player.id);
    const boss: Boss = J(b.bossJson, {});
    const p = boss.paused as { at: string; seq: number; left_ms: number } | undefined;
    if (!p) return { ok: true, battle: state(b) };
    boss.paused = null;
    const done = await ctx.db.update(arenaBattles).set({ bossJson: JSON.stringify(boss), updatedAt: iso() })
      .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.bossJson, b.bossJson))).returning({ id: arenaBattles.id }).all();
    if (!done.length) continue;
    const q = await qrow(ctx, battleId, p.seq);
    if (q && q.status === "issued") {
      const away = Date.now() - Date.parse(p.at);
      const options = J<string[]>(q.optionsJson, []);
      for (let k = options.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [options[k], options[j]] = [options[j], options[k]]; }
      await ctx.db.update(arenaQuestions).set({
        deadlineAt: iso(new Date(Date.now() + Math.max(1000, p.left_ms))), issuedAt: iso(new Date(Date.parse(q.issuedAt!) + away)), optionsJson: JSON.stringify(options),
      }).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, p.seq)));
    }
    return { ok: true, battle: state(await need(ctx, battleId, player.id)) };
  }
  throw err("battle_busy", "The fight changed meanwhile. Try again.");
}

// ── the taunt (Stage A2): once a fight, enrage the boss for a charged ultimate and a bigger reward ───────────────
export const TAUNT_METER = 50;
export const TAUNT_BONUS = 0.25;

/** Taunt the boss: it rages for the rest of the fight (it hits harder); the ultimate gets +50; the win pays +25%. */
export async function taunt(ctx: RequestContext, player: Player, battleId: string) {
  await need(ctx, battleId, player.id);
  await settleTimeout(ctx, battleId, player.id, player);
  const b = await need(ctx, battleId, player.id);
  if (b.status !== "active") throw err("battle_finished", "That battle is over.");
  const boss: Boss = J(b.bossJson, {});
  const mods = (boss.mods ??= {});
  if (mods.taunted) throw err("taunt_used", "You already taunted this one. Once a fight is enough.");
  mods.taunted = true;
  const enraged = !boss.rage;
  boss.rage = true;
  boss.phase = 2;
  const ks: kits.KitState = (boss.kit ??= kits.initKit(null));
  const gain = Math.min(kits.METER_MAX - (ks.meter || 0), TAUNT_METER);
  ks.meter = (ks.meter || 0) + gain;
  const done = await ctx.db.update(arenaBattles).set({ bossJson: JSON.stringify(boss), phase: 2, updatedAt: iso() })
    .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.updatedAt, b.updatedAt))).returning({ id: arenaBattles.id }).all();
  if (!done.length) throw err("taunt_used", "You already taunted this one. Once a fight is enough.");
  return { ok: true, taunt: { meter_gain: gain, enraged, bonus_pct: Math.round(TAUNT_BONUS * 100) }, battle: state((await need(ctx, battleId, player.id))) };
}

export async function castSpell(ctx: RequestContext, player: Player, battleId: string, spell: unknown) {
  if (typeof spell !== "string" || !(spell in SPELLS)) throw new HttpError(400, "invalid_spell", `Spell must be one of: ${Object.keys(SPELLS).join(", ")}.`);
  await need(ctx, battleId, player.id);
  await settleTimeout(ctx, battleId, player.id, player);
  let b = await need(ctx, battleId, player.id);
  if (b.status !== "active") throw err("battle_finished", "That battle is over.");
  const q = b.currentSeq !== null ? await qrow(ctx, battleId, b.currentSeq) : undefined;
  if (!q || q.status !== "issued") throw err("no_question", "There is no question to cast that on.");
  if (Date.now() > Date.parse(q.deadlineAt!)) throw err("question_expired", "Time is up for that question.");
  const boss: Boss = J(b.bossJson, {});
  if (effects.silenced(boss)) throw err("silenced", "You are silenced: no spells for now.");
  const mods = (boss.mods ??= {});
  let cost = SPELLS[spell];
  if (spell === "insight" && q.removedJson) throw err("already_used", "Two wrong answers are already gone from this question.");
  const mech = forBoss(boss);
  if (spell === "insight" && mech && mech.blocksInsight(J(b.intentJson, null))) throw err("riddle_no_insight", "A riddle can't be narrowed down: answer it on your own.");
  if (spell === "timewarp") {
    if (q.timewarped) throw err("already_used", "You already bent time on this question.");
    if (relicsOf(boss).has("hourglass") && !mods.hourglass_used) { cost = 0; mods.hourglass_used = true; }
  }
  if (spell === "insight" && cost && boss.kit && kits.freeInsight(boss.kit)) cost = 0;      // your hero's Insightful
  if (b.focus < cost) throw err("not_enough_focus", `${titleCase(spell)} needs ${cost} Focus.`, { focus: b.focus, cost });
  if (cost && boss.kit) kits.spent(boss.kit, q.seq, cost);
  if (boss.kit) kits.bumpStat(boss.kit, "spell");
  const paid = await ctx.db.update(arenaBattles).set({ focus: sql`${arenaBattles.focus} - ${cost}`, bossJson: JSON.stringify(boss), updatedAt: iso() })
    .where(and(eq(arenaBattles.id, battleId), gte(arenaBattles.focus, cost), eq(arenaBattles.updatedAt, b.updatedAt))).returning({ id: arenaBattles.id }).all();
  if (!paid.length) throw err("not_enough_focus", `${titleCase(spell)} needs ${cost} Focus.`, { focus: b.focus, cost });
  if (spell === "insight") await ctx.db.update(arenaQuestions).set({ removedJson: JSON.stringify(twoWrong(q, boss)) }).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, q.seq)));
  else await ctx.db.update(arenaQuestions).set({ deadlineAt: iso(new Date(Date.parse(q.deadlineAt!) + TIMEWARP_SECONDS * 1000)), timewarped: 1 }).where(and(eq(arenaQuestions.battleId, battleId), eq(arenaQuestions.seq, q.seq)));
  b = await need(ctx, battleId, player.id);
  return { ok: true, spell, cost, battle: state(b), question: publicQuestion((await qrow(ctx, battleId, q.seq))!, b) };
}

// ── leaderboards ─────────────────────────────────────────────────────────────────────────────────────────────
/** Each player's best won battle, best first: topic + difficulty (+ document), or this week's at a difficulty. */
export async function leaderboard(ctx: RequestContext, userId: number, topic: string, difficulty: string, docHash: string | null, scope: "topic" | "global") {
  const where = scope === "global"
    ? sql`difficulty = ${difficulty} AND created_at >= ${iso(weekStart())}`
    : docHash ? sql`topic_key = ${normTopic(topic)} AND difficulty = ${difficulty} AND doc_hash = ${docHash}` : sql`topic_key = ${normTopic(topic)} AND difficulty = ${difficulty}`;
  const rows = await ctx.db.all<{ user_id: number; username: string; grade: string; accuracy: number; time_seconds: number; created_at: string; topic: string }>(sql`
    SELECT * FROM (SELECT s.*, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY accuracy DESC, time_seconds ASC, created_at ASC) AS rn
      FROM arena_scores s WHERE ${where}) WHERE rn = 1 ORDER BY accuracy DESC, time_seconds ASC, created_at ASC LIMIT 100`);
  return rows.map((r, i) => ({
    rank: i + 1, username: r.username, grade: r.grade, accuracy: r.accuracy, time: r.time_seconds, date: r.created_at.slice(0, 10),
    is_me: r.user_id === userId, ...(scope === "global" ? { topic: r.topic } : {}),
  }));
}
