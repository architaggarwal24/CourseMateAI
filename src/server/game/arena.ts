// Arena boss fights, decided by the server (Stage 4.5b; port of backend/services/arena_service.py).
//   create        a battle row + boss + its first telegraphed intent; never an answer
//   nextQuestion  the next question for the player's MOVE (strike / jab / heavy / guard picks its tier, time and
//                 damage; Heavy's Focus is paid here), options shuffled, a server deadline. Asking again returns the
//                 same question and the time left
//   answer        graded here; resolves the turn both ways (the player's hit, the boss's intent, Focus, relics,
//                 the creature's mechanic, the champion's kit, mastery) and rolls the next intent. First answer final
//   end           exactly once (compare-and-set on status): rewards, leaderboard row, personal best, champion XP;
//                 a run battle hands its end to the expedition instead
// Questions come in batches from a model, topped up in the background (ctx.waitUntil); a model failure never
// decides a fight: the battle stays as it is and the request is retryable.
import { and, asc, count, desc, eq, gte, ne, sql } from "drizzle-orm";
import { background } from "../env";
import type { RequestContext } from "../context";
import { arenaBattles, arenaPersonalBests, arenaQuestions, arenaScores, championProgress, courseDocuments, courses, documents, user as userTable } from "../db/schema";
import { HttpError } from "../http";
import type { Caller } from "../ai/run";
import { record as recordMastery } from "../study/mastery";
import { questionKey, sameAnswer } from "../study/text";
import { bossFlavor, generateBattleQuiz, questionTier, type BattleQuestion } from "./arenaAi";
import { baseBoss, summon } from "./bestiary";
import * as tome from "./tome";
import * as roster from "./roster";
import * as scrolls from "./scrolls";
import { bossTaunt, makeIntent, mergeFlavor, playerHit, rollIntent, sanitizeBoss, type Boss, type Intent } from "./boss";
import { ITEMS } from "./content";
import * as kits from "./kits";
import { DAMAGING_KINDS, forBoss, illusionOption, key as mkey, Turn } from "./mechanics";
import { award, activeBuffs, checkAchievements, consumeCharge } from "./progression";
import { consumeInventory, getAvatar, inventory, modifyAvatar, recordRewardEvent, type Player } from "./store";

export const PLAYER_MAX_HP = 10;
const SECONDS_PER_QUESTION = 30;
const DEADLINE_GRACE_MS = 3000;
const MAX_ANSWERS = 40;
const ROUND_SIZE = 5;
const BATCH_SIZE = 6;
const MAX_BATCHES_PER_PHASE = 6;
const LOW_WATER = 2;
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
const timeLimit = (boss: Boss, move?: string | null) =>
  Math.round((MOVES[move || DEFAULT_MOVE]?.seconds ?? SECONDS_PER_QUESTION) * (tome.TIER_TIME[(boss.tier ?? 1) as 1 | 2 | 3 | 4] ?? 1))
  + Number(boss.gear?.time_sec ?? 0) + (relicsOf(boss).has("owl_feather") ? OWL_FEATHER_SECONDS : 0);
const questionLimit = (boss: Boss, q: QRow) => timeLimit(boss, q.move) + (q.timewarped ? TIMEWARP_SECONDS : 0);
const heavyCost = (boss: Boss) => (relicsOf(boss).has("whetstone") ? 1 : MOVES.heavy.cost);
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
function nextIntentFor(boss: Boss, difficulty: string, turn: number): Intent {
  const m = forBoss(boss);
  return (m ? m.scheduled(boss.mech ?? {}, boss, difficulty, turn) : null) ?? rollIntent(boss, difficulty, shieldFactor(boss));
}
const mechanicHud = (boss: Boss, difficulty: string) => forBoss(boss)?.hud(boss.mech ?? {}, boss, difficulty) ?? null;

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
    battle_id: b.id, status: b.status, session_id: b.sessionId, topic: b.topic, difficulty: b.difficulty, phase: b.phase, rage: !!boss.rage,
    boss: { name: boss.name, hp: b.bossHp, max_hp: b.bossMaxHp, species: boss.species, title: boss.title, origin: boss.origin },
    player: { hp: b.playerHp, max_hp: b.playerMaxHp }, combo: b.combo, max_combo: b.maxCombo, answered: b.answered, correct: b.correct,
    heals_used: b.healsUsed, fifty_used: b.fiftyUsed, gear: boss.gear ?? {}, mode: b.mode, run_id: b.runId, focus: b.focus,
    focus_cap: b.focusCap, shield: b.shield, intent: b.intentJson && b.status === "active" ? J(b.intentJson, null) : null,
    relics: [...relicsOf(boss)].sort(), heavy_cost: heavyCost(boss), question_issued: b.status === "active" && b.currentSeq !== null,
    free_timewarp: relicsOf(boss).has("hourglass") && !boss.mods?.hourglass_used, mechanic: mechanicHud(boss, b.difficulty),
    kit: boss.kit ? kits.kitHud(boss.kit) : null, tier: boss.tier ?? 1, bane: tome.baneHud(boss), taunted: !!boss.mods?.taunted,
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

export async function createBattle(ctx: RequestContext, userId: number, o: {
  sessionId: string; docHash: string; topic: string; difficulty: string; boss: Boss; mode?: string; runId?: string | null;
  hearts?: number | null; maxHearts?: number | null; mods?: Record<string, unknown>; hpScale?: number; targets?: string[] | null; focusCap?: number;
}): Promise<Row> {
  const boss = sanitizeBoss({ ...o.boss }, o.difficulty);
  // Bestiary tier: more HP (and, through boss.tier, less time and harder blows); the bane shows once it is known.
  boss.tier = tome.tierOf(String(boss.species ?? ""));
  boss.bane_known = tome.baneKnown((await tome.records(ctx, userId)).get(String(boss.species ?? "")));
  if (o.boss.wanted && o.boss.wanted !== boss.species) await tome.noteTeaser(ctx, userId, o.boss.wanted, o.topic);
  boss.max_hp = Math.round(boss.max_hp * (HP_PACING[o.difficulty] ?? 2.6) * (o.hpScale ?? 1) * (tome.TIER_HP[boss.tier as 1 | 2 | 3 | 4] ?? 1));
  boss.difficulty = o.difficulty;
  boss.current_hp = boss.max_hp;
  const avatar = await getAvatar(ctx, userId);
  boss.gear = gearFor(avatar.equipped);
  // fighting with the champion's own mastery weapon: a small perk, its own animations and a finisher (kits.SIGNATURES)
  boss.kit = kits.initKit(avatar.championId, kits.hasSignature(kits.kitFor(avatar.championId).champion, avatar.equipped));
  const mods: Record<string, any> = { ...(o.mods ?? {}) };
  mods.relics ??= [];
  Object.assign(mods, { aegis_used: false, hourglass_used: false });
  boss.mods = mods;
  if (o.targets?.length) boss.target_concepts = [...o.targets];
  let hearts: number, maxHearts: number;
  if (o.hearts === null || o.hearts === undefined) hearts = maxHearts = PLAYER_MAX_HP + boss.gear.hp;
  else { hearts = o.hearts; maxHearts = o.maxHearts ?? o.hearts; }
  Object.assign(boss, { phase: 1, rage: false, rounds_fought: 0, total_damage_taken: 0, total_damage_dealt: 0, asked_concepts: [] });
  const mech = forBoss(boss);
  if (mech) boss.mech = mech.init(boss, o.difficulty);
  const focusCap = o.focusCap ?? FOCUS_CAP;
  const focus = Math.min(focusCap, (mods.relics.includes("focus_crystal") ? FOCUS_CRYSTAL_START : 0) + Number(mods.focus_bonus ?? 0));
  const intent = nextIntentFor(boss, o.difficulty, 1);
  const now = iso();
  const id = crypto.randomUUID().replace(/-/g, "");
  try {
    await ctx.db.insert(arenaBattles).values({
      id, userId, sessionId: o.sessionId, docHash: o.docHash, topic: o.topic, difficulty: o.difficulty, boardKey: boardKey(o.topic, o.difficulty, o.docHash),
      bossJson: JSON.stringify(boss), bossHp: boss.max_hp, bossMaxHp: boss.max_hp, playerHp: hearts, playerMaxHp: maxHearts, createdAt: now,
      updatedAt: now, mode: o.mode ?? "quick", runId: o.runId ?? null, focus, focusCap, intentJson: JSON.stringify(intent),
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
  if (mech && mech.lockedMoves(boss.mech ?? {}).includes(move)) throw err("move_locked", `The ${boss.name || "boss"} has your ${titleCase(move)} pinned.`, { move });
  const cost = moveCost(move, boss);
  if (b.focus < cost) throw err("not_enough_focus", `${titleCase(move)} needs ${cost} Focus.`, { focus: b.focus, cost });
  const tier = (mech?.forcedTier(intent) ?? null) || MOVES[move].tier;
  const q = await pickQuestion(ctx, battleId, b.phase, tier, b.difficulty, !!(mech && mech.prefersRiddle(intent)));
  if (!q) return null;
  const options = shuffle([...J<BattleQuestion>(q.questionJson, {} as BattleQuestion).options]);
  let bossChanged = false;
  if (mech && mech.wantsIllusion(intent)) {
    const fake = illusionOption(options, await poolAnswers(ctx, battleId, q.seq));
    if (fake) { options.splice(Math.floor(Math.random() * (options.length + 1)), 0, fake); (boss.mech ??= {}).illusion = { seq: q.seq, option: fake }; bossChanged = true; }
  }
  const now = new Date();
  const took = await ctx.db.update(arenaQuestions).set({ status: "issued", optionsJson: JSON.stringify(options), issuedAt: iso(now), deadlineAt: iso(new Date(now.getTime() + timeLimit(boss, move) * 1000)), move })
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
  if (!b || b.status !== "active" || b.currentSeq === null) return null;
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
  kits.prepare(kt);
  let riposte = 0;
  const rage = () => {
    if (boss.current_hp < boss.max_hp * (boss.rage_threshold ?? 0.4) && (boss.phase ?? 1) === 1) { boss.phase = 2; boss.rage = true; phaseChanged = true; }
  };
  // The creature's bane (tome.ts): these moves, answered right in a row, stagger it: x1.5 and it loses its turn.
  const baneHit = tome.trackBane(boss, move, correct);
  if (correct) {
    combo += 1;
    const hit = playerHit(boss, combo, kt.comboExtra);
    dealt = hit.damage; hitType = hit.hit_type;
    if (weak) dealt *= relics.has("scholar_lens") ? 3 : 2;
    const moveMult = move === "jab" && kt.jabMult ? kt.jabMult : MOVES[move].mult;
    dealt = Math.trunc(dealt * moveMult * turn.mult * kt.mult);
    if (baneHit) dealt = Math.trunc(dealt * tome.BANE_MULT);
    if (dealt > 0) {
      const gear = boss.gear ?? {};
      const weaponBonus = Math.round(dealt * Number(gear.damage_pct ?? 0));
      petStrike = combo >= 3 ? Number(gear.strike ?? 0) : 0;
      gearBonus = weaponBonus + petStrike;
      dealt += gearBonus;
    }
    if (shield && dealt && !weak && !kt.ignoreShield) { absorbed = Math.min(shield, dealt); shield -= absorbed; dealt -= absorbed; }
    boss.current_hp = Math.max(0, boss.current_hp - dealt);
    boss.total_damage_taken = (boss.total_damage_taken ?? 0) + dealt;
    boss.rounds_fought = (boss.rounds_fought ?? 0) + 1;
    rage();
    const gain = 1 + (move === "guard" ? 1 : 0) + (move === "jab" ? (relics.has("quill") ? 2 : 1) : 0);
    focusGained = Math.min(focusCap, focus + gain) - focus;
    focus += focusGained;
    if (relics.has("vampiric_tome") && combo % VAMPIRIC_COMBO === 0) lifesteal = 1;
  } else combo = 0;
  let attackName: string | null = null;
  let taunt: string;
  if (boss.current_hp > 0) {
    const kind = intent.kind;
    if (turn.skip || baneHit) { /* takes aim / stunned / staggered by its bane */ }
    else if (DAMAGING_KINDS.includes(kind)) {
      const value = Number(intent.value ?? 0) + turn.bossBonus;
      attackName = intent.name;
      if (turn.dodge) { taken = 0; dodged = true; }
      else if (kt.block || (correct && move === "guard")) { taken = 0; blocked = true; }
      else {
        taken = !correct || turn.noHalve ? value : Math.floor(value / kt.divisor);
        if (kt.halveAfter) taken = Math.floor(taken / 2);
      }
      if (taken > 0 && kt.dodge) { taken = 0; dodged = true; } else { kt.dodge = false; kt.vanished = false; }
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
  const meterGained = kits.charge(kstate, correct, combo);
  let playerHp = Math.max(0, Math.min(b.playerMaxHp, b.playerHp + lifesteal + (mech ? turn.hearts : 0)) - taken - mechDamage);
  if (playerHp <= 0 && relics.has("phoenix_ash") && !mods.phoenix_used) { playerHp = Math.min(PHOENIX_HEARTS, b.playerMaxHp); revived = true; mods.phoenix_used = true; }
  const answered = b.answered + 1;
  const over = boss.current_hp <= 0 || playerHp <= 0 || answered >= MAX_ANSWERS;
  const nextIntent = over ? null : nextIntentFor(boss, b.difficulty, answered + 1);
  const now = new Date();
  const spent = Math.min((now.getTime() - Date.parse(q.issuedAt!)) / 1000, questionLimit(boss, q));
  const outcome = {
    question_id: q.seq, correct, timed_out: timedOut, answer: picked, correct_answer: correctOption, explanation: question.explanation || null,
    move, tier: questionTier(question.difficulty, b.difficulty), damage_dealt: dealt, hit_type: hitType, weakness: weak && correct,
    damage_taken: taken, attack_name: attackName, taunt, phase_changed: phaseChanged, combo, gear_bonus: gearBonus, pet_strike: petStrike,
    intent, next_intent: nextIntent, blocked, interrupted, shield_absorbed: absorbed, boss_healed: healed, focus, focus_gained: focusGained,
    focus_drained: drained, aegis, revived, lifesteal, dodged, riposte, kit_meter_gained: meterGained,
    bane: baneHit ? { landed: true, found: false } : null,
    kit: { events: kt.events, refund: kt.refund, hud: kits.kitHud(kstate) },
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
  else if (playerHp <= 0 || answered >= MAX_ANSWERS) await end(ctx, player, battleId, "lost");
  return outcome;
}

// ── ending ───────────────────────────────────────────────────────────────────────────────────────────────────
type RunEnd = (ctx: RequestContext, player: Player, b: Row, status: string) => Promise<unknown>;
let onRunBattleEnd: RunEnd | null = null;
/** The expedition takes over the end of its battles (expedition.ts registers itself). */
export function setRunBattleEnd(fn: RunEnd) { onRunBattleEnd = fn; }

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
  const result: Record<string, unknown> = { grade, accuracy, time_seconds: seconds, new_personal_best: false, missed: await missed(ctx, battleId),
    champion: await championXp(ctx, player.id, b, status === "won") };
  // the Bestiary: the record, first defeat, mastery, a newly opened tier (every mode counts, runs too)
  const fought = String(J<Boss>(b.bossJson, {}).species ?? "");
  const fight = await tome.recordFight(ctx, player.id, {
    // flawless (no heart lost) counts toward gold mastery on hard or nightmare only
    species: fought, won: status === "won", flawless: b.playerHp >= b.playerMaxHp && (b.difficulty === "hard" || b.difficulty === "nightmare"),
    nightmare: b.difficulty === "nightmare", seconds, accuracy,
  });
  result.bestiary = fight;
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
      if (J<Boss>(b.bossJson, {}).mods?.taunted && won) {
        const bonus = { xp: Math.round(Number(won.xp_gained ?? 0) * TAUNT_BONUS), coins: Math.round(Number(won.coins_gained ?? 0) * TAUNT_BONUS) };
        const res = await recordRewardEvent(ctx, player.id, "taunt_bonus", bonus.xp, bonus.coins, battleId, `u${player.id}:taunt:${battleId}`);
        if (res.applied && (bonus.xp || bonus.coins)) result.taunt_bonus = bonus;
      }
    }
  }
  await ctx.db.update(arenaBattles).set({ rewardsJson: JSON.stringify(paid), resultJson: JSON.stringify(result) }).where(eq(arenaBattles.id, battleId));
  return paid;
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
  let question = null;
  if (item === "heal") {
    if (b.playerHp >= b.playerMaxHp) throw err("hp_full", "Your hearts are already full.");
    if (!await consume(ctx, player.id, "heal")) throw err("no_stock", "You don't have a health potion.");
    await ctx.db.update(arenaBattles).set({ playerHp: sql`MIN(${arenaBattles.playerHp} + 1, ${arenaBattles.playerMaxHp})`, healsUsed: sql`${arenaBattles.healsUsed} + 1`, updatedAt: iso() }).where(eq(arenaBattles.id, battleId));
  } else {
    const q = b.currentSeq !== null ? await qrow(ctx, battleId, b.currentSeq) : undefined;
    if (!q || q.status !== "issued") throw err("no_question", "There is no question to use that on.");
    if (q.removedJson) throw err("already_used", "You already used 50/50 on this question.");
    if (!await consume(ctx, player.id, "fifty_fifty")) throw err("no_stock", "You don't have a 50/50 charge.");
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
  const q = b.currentSeq !== null ? await qrow(ctx, battleId, b.currentSeq) : undefined;
  const open = !!q && q.status === "issued" && Date.now() <= Date.parse(q.deadlineAt!);
  if ((fx.insight || fx.timewarp) && !open) ks.library_pending = true;
  const done = await ctx.db.update(arenaBattles).set({ bossJson: JSON.stringify(boss), playerHp: sql`${arenaBattles.playerHp} + ${hearts}`, updatedAt: iso() })
    .where(and(eq(arenaBattles.id, battleId), eq(arenaBattles.updatedAt, b.updatedAt))).returning({ id: arenaBattles.id }).all();
  if (!done.length) throw err("ultimate_active", "Your ultimate is already in play.");
  if ((fx.insight || fx.timewarp) && open) await freeSpells(ctx, battleId, q!.seq, boss, J(b.intentJson, null));
  b = await need(ctx, battleId, player.id);
  return { ok: true, ultimate: { ...fx, hearts }, battle: state(b), question: open ? publicQuestion((await qrow(ctx, battleId, q!.seq))!, b) : null };
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
  const mods = (boss.mods ??= {});
  let cost = SPELLS[spell];
  if (spell === "insight" && q.removedJson) throw err("already_used", "Two wrong answers are already gone from this question.");
  const mech = forBoss(boss);
  if (spell === "insight" && mech && mech.blocksInsight(J(b.intentJson, null))) throw err("riddle_no_insight", "A riddle can't be narrowed down: answer it on your own.");
  if (spell === "timewarp") {
    if (q.timewarped) throw err("already_used", "You already bent time on this question.");
    if (relicsOf(boss).has("hourglass") && !mods.hourglass_used) { cost = 0; mods.hourglass_used = true; }
  }
  if (b.focus < cost) throw err("not_enough_focus", `${titleCase(spell)} needs ${cost} Focus.`, { focus: b.focus, cost });
  if (cost && boss.kit) kits.spent(boss.kit, q.seq, cost);
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
