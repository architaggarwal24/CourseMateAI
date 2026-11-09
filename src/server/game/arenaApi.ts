// The arena's routes, as functions (Stage 4.5b; the flows of backend/routers/arena.py).
import type { CurrentUser, RequestContext } from "../context";
import { HttpError } from "../http";
import { callerFor } from "../chat";
import { studyDocs } from "../documents";
import { weakConcepts } from "../study/mastery";
import { validateTopic } from "../study/text";
import { expeditionActs } from "./arenaAi";
import * as arena from "./arena";
import { VALID_DIFFICULTIES } from "./boss";
import * as exp from "./expedition";
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
  const mode = body.mode === "nemesis" ? "nemesis" : "quick";
  let topic = mode === "quick" ? validateTopic(body.topic) : "";
  const difficulty = checkDifficulty(body.difficulty);
  const sessionId = String(body.session_id ?? "");
  const study = await studyDocs(ctx, user, sessionId);
  let targets: string[] | null = null;
  if (mode === "nemesis") { targets = await nemesisTargets(ctx, user.id, study.hash); topic = `Nemesis: ${targets.join(", ")}`.slice(0, 100); }
  const caller = await callerFor(ctx, user);
  const existing = await arena.findActive(ctx, user.id, sessionId);
  if (existing) {
    if (existing.mode === mode && existing.difficulty === difficulty && (mode === "nemesis" || existing.topic === topic)) {
      arena.prefetch(ctx, caller, existing.id, user.id);
      return { ok: true, battle_id: existing.id, resumed: true, boss: arena.publicBoss(existing), battle: arena.state(existing) };
    }
    throw new HttpError(409, "battle_in_progress", "You already have a battle running for this document. Finish or forfeit it first.", null, { battle_id: existing.id });
  }
  // only creatures whose Bestiary tier is open answer a topic (a locked one sends the closest open creature). A Hunt
  // (the Bestiary's Hunt button) asks for one creature: it must be open.
  const open = await arena.summonable(ctx, user.id);
  const hunt = mode === "quick" && typeof body.species === "string" && body.species ? body.species : null;
  if (hunt && !open.has(hunt)) {
    throw new HttpError(409, "creature_sealed", "That creature's page is still sealed. Beat creatures of the tier before it first.", null, { species: hunt });
  }
  const boss = await arena.newBoss(topic, difficulty, open, hunt);
  const b = await arena.createBattle(ctx, user.id, { sessionId, docHash: study.hash, topic, difficulty, boss, mode, targets });
  await markActive(ctx, player);
  arena.prefetch(ctx, caller, b.id, user.id);
  arena.enrich(ctx, caller, b.id, user.id);
  return { ok: true, battle_id: b.id, resumed: false, boss: arena.publicBoss(b), battle: arena.state(b) };
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
  if (typeof battleId === "string") { arena.prefetch(ctx, caller, battleId, user.id); arena.enrich(ctx, caller, battleId, user.id); }
  return { ok: true, ...result };
}
