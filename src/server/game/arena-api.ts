// The arena's routes, as functions (Stage 4.5b; the flows of backend/routers/arena.py).
import type { CurrentUser, RequestContext } from "../context";
import { HttpError } from "../http";
import { callerFor } from "../chat";
import { studyDocs } from "../study/documents";
import { weakConcepts } from "../study/mastery";
import { validateTopic } from "../study/text";
import { expeditionActs } from "./arena-ai";
import * as arena from "./arena";
import { VALID_DIFFICULTIES } from "./boss";
import * as exp from "./expedition";
import * as gauntlet from "./gauntlet";
import * as invasion from "./invasion";
import * as seasons from "./season";
import { SEASON_MIN_CONCEPTS } from "@/lib/game/seasons";
import { markActive } from "./progression";
import type { Player } from "./store";

type Body = Record<string, unknown>;
const NEMESIS_TARGETS = 5;
const checkDifficulty = (d: unknown): string => {
  if (typeof d !== "string" || !(VALID_DIFFICULTIES as readonly string[]).includes(d)) {
    throw new HttpError(400, "invalid_input", `Difficulty must be one of: ${VALID_DIFFICULTIES.join(", ")}.`);
  }
  return d;
};
const generationFailed = (m: string) => new HttpError(500, "generation_failed", m, "retry");

export async function leaderboard(ctx: RequestContext, user: CurrentUser, q: URLSearchParams) {
  const difficulty = q.get("difficulty") ?? "";
  if (!(VALID_DIFFICULTIES as readonly string[]).includes(difficulty)) throw new HttpError(400, "invalid_input", "Invalid difficulty.");
  const scope = q.get("scope") === "global" ? "global" : "topic";
  const topic = q.get("topic") ?? "";
  if (scope === "topic" && !topic.trim()) throw new HttpError(400, "invalid_input", "Topic is required for a topic board.");
  const sessionId = q.get("session_id");
  const docHash = sessionId && scope === "topic" ? (await studyDocs(ctx, user, sessionId)).hash : null;
  const entries = await arena.leaderboard(ctx, user.id, topic, difficulty, docHash, scope);
  return { ok: true, date: q.get("date") ?? "", scope, entries, total: entries.length };
}

export async function weak(ctx: RequestContext, user: CurrentUser, sessionId: string, limit: number) {
  const hash = (await studyDocs(ctx, user, sessionId)).hash;
  const all = await weakConcepts(ctx, user.id, hash, 1000);
  return { ok: true, concepts: all.slice(0, Math.max(1, Math.min(limit || 8, 30))), missed_total: all.length, nemesis_ready: all.length >= exp.NEMESIS_MIN_CONCEPTS };
}

async function nemesisTargets(ctx: RequestContext, userId: number, hash: string) {
  const all = await weakConcepts(ctx, userId, hash, 1000);
  if (all.length < exp.NEMESIS_MIN_CONCEPTS) {
    throw new HttpError(409, "not_enough_data", `A Nemesis needs at least ${exp.NEMESIS_MIN_CONCEPTS} concepts you have missed on this document. Keep playing, quizzing and reviewing first.`,
      null, { missed_concepts: all.length, needed: exp.NEMESIS_MIN_CONCEPTS });
  }
  return all.slice(0, NEMESIS_TARGETS).map((c) => c.concept);
}

/** Start a battle, or resume the one already running on this document with the same mode, topic and difficulty. */
export async function createBattle(ctx: RequestContext, user: CurrentUser, player: Player, body: Body) {
  const mode = body.mode === "nemesis" ? "nemesis" : body.mode === "invasion" ? "invasion" : body.mode === "season" ? "season" : "quick";
  let topic = mode === "quick" ? validateTopic(body.topic) : "";
  const difficulty = checkDifficulty(body.difficulty);
  const sessionId = String(body.session_id ?? "");
  const study = await studyDocs(ctx, user, sessionId);
  let targets: string[] | null = null;
  if (mode === "nemesis") { targets = await nemesisTargets(ctx, user.id, study.hash); topic = `Nemesis: ${targets.join(", ")}`.slice(0, 100); }
  // two worlds, Stage 5: the weekly invasion - a boss made of what you studied this week
  let invader: string | null = null;
  if (mode === "invasion") {
    targets = await invasion.weekConcepts(ctx, user.id, study.hash);
    if (targets.length < invasion.INVASION_MIN) {
      throw new HttpError(409, "invasion_quiet", `Nothing stirs yet: study at least ${invasion.INVASION_MIN} concepts on this document this week.`, null, { concepts: targets.length, needed: invasion.INVASION_MIN });
    }
    topic = `Invasion: ${targets.join(", ")}`.slice(0, 100);
    invader = invasion.invader(user.id, invasion.weekKey(), await arena.summonable(ctx, user.id));
  }
  // two worlds, Stage 7: the season's limited boss - made of this month's concepts, on its own stage
  const season = mode === "season" ? seasons.seasonFor(body.preview, user.admin) : null;
  if (mode === "season") {
    if (!season) throw new HttpError(409, "no_season", "No season is on right now.");
    targets = await seasons.monthConcepts(ctx, user.id, study.hash);
    if (targets.length < SEASON_MIN_CONCEPTS) {
      throw new HttpError(409, "season_quiet", `${season.bossName} needs more to feed on: study at least ${SEASON_MIN_CONCEPTS} concepts on this document this month.`, null, { concepts: targets.length, needed: SEASON_MIN_CONCEPTS });
    }
    topic = `${season.name}: ${targets.join(", ")}`.slice(0, 100);
    invader = season.boss;
  }
  const caller = await callerFor(ctx, user);
  // defer (Stage 5): the battle is made at once and its questions written by POST .../prepare, while the player
  // picks a champion and faces the boss on the VS screen
  const defer = body.defer === true;
  const existing = await arena.findActive(ctx, user.id, sessionId);
  if (existing) {
    if (existing.mode === mode && existing.difficulty === difficulty && (mode !== "quick" || existing.topic === topic)) {
      if (!defer) await arena.prepare(ctx, caller, existing.id, user.id);          // (one whose questions failed to come: again)
      arena.prefetch(ctx, caller, existing.id, user.id);
      const now = await arena.getBattle(ctx, user.id, existing.id);
      return { ok: true, battle_id: existing.id, resumed: true, boss: arena.publicBoss(now), battle: arena.state(now) };
    }
    throw new HttpError(409, "battle_in_progress", "You already have a battle running for this document. Finish or forfeit it first.", null, { battle_id: existing.id });
  }
  // only creatures whose Bestiary tier is open answer a topic (a locked one sends the closest open creature). A Hunt
  // (the Bestiary's Hunt button) asks for one creature: it must be open.
  const open = await arena.summonable(ctx, user.id);
  const hunt = mode === "quick" && typeof body.species === "string" && body.species ? body.species : invader;
  if (hunt && mode === "quick" && !open.has(hunt)) {
    throw new HttpError(409, "creature_sealed", "That creature's page is still sealed. Beat creatures of the tier before it first.", null, { species: hunt });
  }
  const boss = await arena.newBoss(topic, difficulty, open, hunt);
  if (season) Object.assign(boss, { name: season.bossName, season: season.id, stage: season.stage });
  const created = await arena.createBattle(ctx, user.id, { sessionId, docHash: study.hash, topic, difficulty, boss, mode, targets });
  await markActive(ctx, player);
  // the whole fight's questions are written before it starts (now, or by .../prepare), so it never stops to wait
  if (!defer) {
    await arena.prepare(ctx, caller, created.id, user.id);
    arena.enrich(ctx, caller, created.id, user.id);
  }
  const b = await arena.getBattle(ctx, user.id, created.id);
  return { ok: true, battle_id: b.id, resumed: false, boss: arena.publicBoss(b), battle: arena.state(b) };
}

/** Write a deferred battle's questions (character select and the VS screen run meanwhile); a second call waits for nothing. */
export async function prepareBattle(ctx: RequestContext, user: CurrentUser, id: string) {
  const caller = await callerFor(ctx, user);
  const before = await arena.getBattle(ctx, user.id, id);
  await arena.prepare(ctx, caller, id, user.id);
  if (!arena.state(before).prepared) arena.enrich(ctx, caller, id, user.id);
  const b = await arena.getBattle(ctx, user.id, id);
  return { ok: true, battle_id: b.id, boss: arena.publicBoss(b), battle: arena.state(b) };
}

/** Character select: fight this (not yet started) battle as the account's champion now. */
export async function rearmBattle(ctx: RequestContext, user: CurrentUser, id: string) {
  const b = await arena.rearm(ctx, user.id, id);
  return { ok: true, battle_id: b.id, boss: arena.publicBoss(b), battle: arena.state(b) };
}

export async function activeBattle(ctx: RequestContext, user: CurrentUser, sessionId: string | null) {
  const b = await arena.findActive(ctx, user.id, sessionId || null);
  return { ok: true, battle: b ? { ...arena.state(b), boss_profile: arena.publicBoss(b) } : null };
}

export async function getBattle(ctx: RequestContext, user: CurrentUser, id: string) {
  const b = await arena.getBattle(ctx, user.id, id);
  return { ok: true, battle_id: b.id, boss: arena.publicBoss(b), battle: arena.state(b) };
}

export async function question(ctx: RequestContext, user: CurrentUser, player: Player, id: string, move: string | null) {
  const r = await arena.nextQuestion(ctx, await callerFor(ctx, user), player, id, move);
  return { ok: true, ...r, stock: await arena.stock(ctx, user.id) };
}

export async function answer(ctx: RequestContext, user: CurrentUser, player: Player, id: string, body: Body) {
  const r = await arena.answer(ctx, player, id, body.question_id, body.answer);
  arena.prefetch(ctx, await callerFor(ctx, user), id, user.id);
  return r;
}

// ── expeditions ──────────────────────────────────────────────────────────────────────────────────────────────
export async function createRun(ctx: RequestContext, user: CurrentUser, player: Player, body: Body) {
  const difficulty = checkDifficulty(body.difficulty);
  const sessionId = String(body.session_id ?? "");
  const study = await studyDocs(ctx, user, sessionId);
  const existing = await exp.findActive(ctx, user.id, sessionId);
  if (existing) {
    if (existing.difficulty !== difficulty) {
      throw new HttpError(409, "run_in_progress", "You already have an expedition running on this document. Finish or abandon it first.", null, { run_id: existing.id, difficulty: existing.difficulty });
    }
    return { ok: true, resumed: true, run: await exp.state(ctx, existing) };
  }
  let acts;
  try { acts = await expeditionActs(ctx, await callerFor(ctx, user), study.docs, 3); }
  catch (e) { if (e instanceof HttpError) throw e; throw generationFailed("The expedition map could not be drawn. Please try again."); }
  const run = await exp.createRun(ctx, user.id, sessionId, study.hash, difficulty, acts);
  await markActive(ctx, player);
  return { ok: true, resumed: false, run: await exp.state(ctx, run) };
}

export async function activeRun(ctx: RequestContext, user: CurrentUser, sessionId: string | null) {
  const run = await exp.findActive(ctx, user.id, sessionId || null);
  return { ok: true, run: run ? await exp.state(ctx, run) : null };
}

export async function runLeaderboard(ctx: RequestContext, user: CurrentUser, q: URLSearchParams) {
  const scope = q.get("scope") === "global" ? "global" : "document";
  let hash: string | null = null;
  if (scope === "document") {
    const sid = q.get("session_id");
    if (!sid) throw new HttpError(400, "invalid_input", "session_id is required for a document board.");
    hash = (await studyDocs(ctx, user, sid)).hash;
  }
  const entries = await exp.leaderboard(ctx, user.id, scope, hash);
  return { ok: true, scope, entries, total: entries.length };
}

export async function travel(ctx: RequestContext, user: CurrentUser, runId: string, body: Body) {
  const nodeId = String(body.node_id ?? "");
  const plan = await exp.planTravel(ctx, user.id, runId, nodeId);
  const caller = await callerFor(ctx, user);
  const boss = plan.fight ? await arena.newBoss(plan.topic!, plan.difficulty, await arena.summonable(ctx, user.id)) : null;
  const result = await exp.travel(ctx, user.id, runId, nodeId, boss);
  const battleId = (result as { battle_id?: unknown }).battle_id;
  if (typeof battleId === "string") {
    // the run has already moved on to the fight: if its questions can't be written now, the fight writes them as it goes
    try { await arena.prepare(ctx, caller, battleId, user.id); } catch (e) { console.warn(`[coursemate-arena] run ${runId}: preparing failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`); }
    arena.prefetch(ctx, caller, battleId, user.id);
    arena.enrich(ctx, caller, battleId, user.id);
  }
  return { ok: true, ...result };
}

// ── Boss Rush and Survival (Stage 6) ─────────────────────────────────────────────────────────────────────────────
/** The hub: power level, Boss Rush's lock and bosses, bests, a run of fights in progress. */
export const gauntletOverview = (ctx: RequestContext, user: CurrentUser, sessionId: string | null) => gauntlet.overview(ctx, user.id, sessionId || null);

/** Start a Boss Rush or Survival on a topic: the first fight is made at once (questions by .../prepare, as Stage 5). */
export async function createGauntlet(ctx: RequestContext, user: CurrentUser, player: Player, body: Body) {
  const kind = body.kind === "rush" ? "rush" : body.kind === "survival" ? "survival" : null;
  if (!kind) throw new HttpError(400, "invalid_input", "Choose Boss Rush or Survival.");
  const topic = validateTopic(body.topic);
  const sessionId = String(body.session_id ?? "");
  const study = await studyDocs(ctx, user, sessionId);
  const r = await gauntlet.create(ctx, user.id, { kind, sessionId, docHash: study.hash, topic });
  await markActive(ctx, player);
  return { ok: true, ...r };
}

export async function activeGauntlet(ctx: RequestContext, user: CurrentUser, sessionId: string | null) {
  const g = await gauntlet.findActive(ctx, user.id, sessionId || null);
  return { ok: true, gauntlet: g ? gauntlet.state(g) : null };
}

export const getGauntlet = async (ctx: RequestContext, user: CurrentUser, id: string) => ({ ok: true, gauntlet: await gauntlet.get(ctx, user.id, id) });

/** The next fight after a win (or the one already made). */
export const nextGauntletFight = async (ctx: RequestContext, user: CurrentUser, id: string) => ({ ok: true, ...(await gauntlet.next(ctx, user.id, id)) });

export const abandonGauntlet = (ctx: RequestContext, player: Player, id: string) => gauntlet.abandon(ctx, player, id);

/** Two worlds, Stage 5: this week's invasion on a document (ready, who, of what, already repelled). */
export async function invasionInfo(ctx: RequestContext, user: CurrentUser, sessionId: string | null) {
  let hash: string | null = null;
  if (sessionId) { try { hash = (await studyDocs(ctx, user, sessionId)).hash; } catch { hash = null; } }
  return invasion.invasionState(ctx, user.id, hash, await arena.summonable(ctx, user.id));
}

/** Two worlds, Stage 7: the season on now (an admin can ?preview=<id> one out of its dates) and its boss on a document. */
export async function seasonInfo(ctx: RequestContext, user: CurrentUser, sessionId: string | null, preview: string | null) {
  let hash: string | null = null;
  if (sessionId) { try { hash = (await studyDocs(ctx, user, sessionId)).hash; } catch { hash = null; } }
  return seasons.seasonState(ctx, user.id, hash, seasons.seasonFor(preview, user.admin));
}
