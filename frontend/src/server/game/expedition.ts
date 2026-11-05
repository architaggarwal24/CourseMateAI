// Expedition: a roguelite run through a document (Stage 4.5b; port of backend/services/expedition_service.py).
//   create       3 acts (chapter + topic, named by a model once), a seed, every act's node map built from it
//   planTravel   checks a move without changing anything (a fight needs a boss first)
//   travel       a fight node starts an ordinary arena battle with the run's hearts, relics and Focus bonus;
//                rest / shop leave a choice; treasure gives a relic at once
//   choose       rest: heal | study, shop: buy | leave, relic offer: take | skip
//   battleEnded  the arena hands over the end of a run battle: hearts, gold, relic offer, next act or the run's end
// A run ends once (compare-and-set) and pays one expedition_complete, scaled by depth.
import { and, desc, eq, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { arenaBattles, arenaRuns, documents, missedQuestions } from "../db/schema";
import { HttpError } from "../http";
import { conceptKey } from "../study/review";
import { weakConcepts } from "../study/mastery";
import { createBattle, end as endBattle, gearFor, PLAYER_MAX_HP, publicBoss, setRunBattleEnd, state as battleState, weekStart } from "./arena";
import type { Boss } from "./boss";
import { relics as RELICS } from "./content";
import { award } from "./progression";
import { getAvatar, type Player } from "./store";

const ACTS = 3, LAYERS = 4;
const FIGHT_KINDS = ["battle", "elite", "nemesis", "boss"];
const NODE_WEIGHTS: Record<string, Record<string, number>> = {
  middle: { battle: 40, elite: 14, nemesis: 14, rest: 12, shop: 10, treasure: 10 },
  last: { battle: 28, elite: 14, nemesis: 10, rest: 28, shop: 12, treasure: 8 },
};
const DIFFICULTY_UP: Record<string, string> = { easy: "medium", medium: "hard", hard: "nightmare", nightmare: "nightmare" };
const HP_SCALE: Record<string, number> = { battle: 1, nemesis: 1, elite: 1.25, boss: 1.5 };
const GOLD: Record<string, number> = { battle: 20, nemesis: 30, elite: 40, boss: 60 };
const LUCKY_COIN = 1.25;
const POINTS: Record<string, number> = { battle: 100, nemesis: 150, elite: 200, boss: 400, rest: 25, shop: 25, treasure: 25 };
const WIN_BONUS = 1000, HEART_POINTS = 20, REST_HEAL_PCT = 0.3, IRON_WILL_HEARTS = 2, RELIC_CHOICES = 3, SHOP_RELICS = 3;
const POTION = { id: "potion", kind: "potion", name: "Healing Draught", description: "Restore 2 hearts.", price: 30, heal: 2 };
const TREASURE_FALLBACK_GOLD = 50, NEMESIS_TARGETS = 5;
export const NEMESIS_MIN_CONCEPTS = 3;

type Run = typeof arenaRuns.$inferSelect;
type Node = { id: string; layer: number; index: number; kind: string; edges: string[] };
type ActMap = { act: number; nodes: Node[]; boss: string };
const iso = () => new Date().toISOString();
const J = <T = any,>(s: string | null | undefined, d: T): T => { if (!s) return d; try { return JSON.parse(s) as T; } catch { return d; } };
const err = (code: string, message: string, details: Record<string, unknown> | null = null, status = 409) => new HttpError(status, code, message, null, details);

// ── a seeded random source (the same seed + purpose always gives the same map and offers) ──────────────────────
export function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    random,
    choice: <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)],
    weighted: <T,>(list: T[], weights: number[]) => {
      let r = random() * weights.reduce((x, y) => x + y, 0);
      for (let i = 0; i < list.length; i++) { if (r < weights[i]) return list[i]; r -= weights[i]; }
      return list[list.length - 1];
    },
  };
}

const relicCatalog = () => new Map(RELICS.relics.map((r) => [r.id, r]));
export function publicRelic(id: string) {
  const r = relicCatalog().get(id) ?? { id, name: id, description: "", rarity: "common" };
  return Object.fromEntries(["id", "name", "description", "rarity"].filter((k) => k in r).map((k) => [k, (r as Record<string, unknown>)[k]]));
}

function edges(rng: ReturnType<typeof seeded>, nFrom: number, nTo: number): number[][] {
  const out = Array.from({ length: nFrom }, () => new Set<number>());
  const scale = (nTo - 1) / Math.max(nFrom - 1, 1);
  for (let j = 0; j < nFrom; j++) {
    const t = Math.round(j * scale);
    out[j].add(t);
    const side = t + rng.choice([-1, 1]);
    if (side >= 0 && side < nTo && rng.random() < 0.5) out[j].add(side);
  }
  const reached = new Set(out.flatMap((e) => [...e]));
  const back = (nFrom - 1) / Math.max(nTo - 1, 1);
  for (let k = 0; k < nTo; k++) if (!reached.has(k)) out[Math.round(k * back)].add(k);
  return out.map((e) => [...e].sort((a, b) => a - b));
}

/** One act's node map: a pure function of (seed, act, nemesisOk). Every node is reachable and leads to the boss. */
export function buildMap(seed: number, act: number, nemesisOk: boolean): ActMap {
  const rng = seeded(`expedition:${seed}:${act}`);
  const sizes = Array.from({ length: LAYERS }, () => rng.choice([2, 3]));
  const nodes: Node[] = [];
  sizes.forEach((size, layer) => {
    const w = { ...NODE_WEIGHTS[layer === LAYERS - 1 ? "last" : "middle"] };
    if (!nemesisOk) delete w.nemesis;
    const kinds = Object.keys(w);
    for (let i = 0; i < size; i++) {
      nodes.push({ id: `${act}-${layer}-${i}`, layer, index: i, kind: layer === 0 ? "battle" : rng.weighted(kinds, kinds.map((k) => w[k])), edges: [] });
    }
  });
  const byLayer = Array.from({ length: LAYERS }, (_, l) => nodes.filter((n) => n.layer === l));
  for (let l = 0; l < LAYERS - 1; l++) edges(rng, sizes[l], sizes[l + 1]).forEach((targets, j) => { byLayer[l][j].edges = targets.map((t) => byLayer[l + 1][t].id); });
  const bossId = `${act}-boss`;
  for (const n of byLayer[LAYERS - 1]) n.edges = [bossId];
  nodes.push({ id: bossId, layer: LAYERS, index: 0, kind: "boss", edges: [] });
  return { act, nodes, boss: bossId };
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────
const runRow = (ctx: RequestContext, id: string) => ctx.db.select().from(arenaRuns).where(eq(arenaRuns.id, id)).get();
async function need(ctx: RequestContext, id: string, userId: number): Promise<Run> {
  const r = await ctx.db.select().from(arenaRuns).where(and(eq(arenaRuns.id, String(id)), eq(arenaRuns.userId, userId))).get();
  if (!r) throw new HttpError(404, "run_not_found", "We couldn't find that expedition.");
  return r;
}

/** The active run on a document, or the latest active one whose document can still be loaded. */
export async function findActive(ctx: RequestContext, userId: number, sessionId?: string | null) {
  const rows = await ctx.db.select().from(arenaRuns).where(and(eq(arenaRuns.userId, userId), eq(arenaRuns.status, "active"), ...(sessionId ? [eq(arenaRuns.sessionId, sessionId)] : [])))
    .orderBy(desc(arenaRuns.createdAt)).all();
  for (const r of rows) if (await documentReady(ctx, r)) return r;
  return rows[0] ?? null;
}

async function documentReady(ctx: RequestContext, run: Run) {
  return !!(await ctx.db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, run.sessionId), eq(documents.userId, run.userId), eq(documents.status, "ready"))).get());
}

const actMap = (run: Run, act?: number): ActMap => J<ActMap[]>(run.mapJson, [])[(act ?? run.act) - 1];
const nodeOf = (m: ActMap, id: string) => m.nodes.find((n) => n.id === id) ?? null;

function reachable(run: Run): string[] {
  if (run.status !== "active" || run.battleId || run.pendingJson) return [];
  const m = actMap(run);
  if (!run.nodeId) return m.nodes.filter((n) => n.layer === 0).map((n) => n.id);
  return [...(nodeOf(m, run.nodeId)?.edges ?? [])];
}

export async function state(ctx: RequestContext, run: Run) {
  const acts = J<{ title: string; topic: string }[]>(run.actsJson, []);
  return {
    run_id: run.id, status: run.status, session_id: run.sessionId, difficulty: run.difficulty, act: run.act, acts_total: ACTS, acts,
    act_title: acts[run.act - 1]?.title, map: actMap(run), node_id: run.nodeId, visited: J(run.visitedJson, []), reachable: reachable(run),
    hearts: run.hearts, max_hearts: run.maxHearts, gold: run.gold, relics: J<string[]>(run.relicsJson, []).map(publicRelic),
    focus_cap: run.focusCap, act_focus_bonus: run.actFocusBonus, pending: J(run.pendingJson, null), battle_id: run.battleId, depth: run.depth,
    battles_won: run.battlesWon, score: run.score, flags: J(run.flagsJson, {}), document_ready: await documentReady(ctx, run),
    ...(run.status !== "active" ? { result: J(run.resultJson, {}), rewards: J(run.rewardsJson, null) } : {}),
  };
}

export const getRun = (ctx: RequestContext, userId: number, id: string) => need(ctx, id, userId);

async function missedCount(ctx: RequestContext, userId: number, docHash: string) {
  return (await weakConcepts(ctx, userId, docHash, 1000)).length;
}
export const nemesisReady = async (ctx: RequestContext, userId: number, docHash: string) => (await missedCount(ctx, userId, docHash)) >= NEMESIS_MIN_CONCEPTS;

export async function createRun(ctx: RequestContext, userId: number, sessionId: string, docHash: string, difficulty: string, rawActs: { title?: string; topic: string }[], seed?: number) {
  const acts = rawActs.map((a) => ({ title: String(a.title || a.topic).slice(0, 100), topic: String(a.topic).slice(0, 100) })).slice(0, ACTS);
  if (acts.length < ACTS) throw new Error(`an expedition needs ${ACTS} acts`);
  const s = seed ?? 1 + Math.floor(Math.random() * (2 ** 31 - 2));
  const ok = await nemesisReady(ctx, userId, docHash);
  const maps = Array.from({ length: ACTS }, (_, i) => buildMap(s, i + 1, ok));
  const hearts = PLAYER_MAX_HP + gearFor((await getAvatar(ctx, userId)).equipped).hp;
  const now = iso();
  const id = crypto.randomUUID().replace(/-/g, "");
  try {
    await ctx.db.insert(arenaRuns).values({ id, userId, sessionId, docHash, difficulty, seed: s, actsJson: JSON.stringify(acts), mapJson: JSON.stringify(maps),
      nemesisOk: ok ? 1 : 0, hearts, maxHearts: hearts, createdAt: now, updatedAt: now });
  } catch (e) {
    if (String((e as Error)?.message ?? e).includes("UNIQUE")) throw err("run_in_progress", "You already have an expedition running on this document.");
    throw e;
  }
  return need(ctx, id, userId);
}

// ── travelling ───────────────────────────────────────────────────────────────────────────────────────────────
async function fightPlan(ctx: RequestContext, run: Run, node: Node) {
  const act = J<{ topic: string }[]>(run.actsJson, [])[run.act - 1];
  const plan: { topic: string; difficulty: string; targets: string[] | null } = { topic: act.topic, difficulty: run.difficulty, targets: null };
  if (node.kind === "elite" || node.kind === "boss") plan.difficulty = DIFFICULTY_UP[run.difficulty];
  if (node.kind === "nemesis") {
    const targets = (await weakConcepts(ctx, run.userId, run.docHash, NEMESIS_TARGETS)).map((c) => c.concept);
    if (targets.length) { plan.targets = targets; plan.topic = `Nemesis: ${targets.join(", ")}`.slice(0, 100); }
  }
  return plan;
}

async function checkCanTravel(ctx: RequestContext, run: Run, nodeId: string) {
  if (run.status !== "active") throw err("run_finished", "That expedition is over.");
  if (run.battleId) throw err("battle_in_progress", "Finish the fight first.", { battle_id: run.battleId });
  if (run.pendingJson) throw err("choice_pending", "Make your choice first.", { pending: J<{ kind: string }>(run.pendingJson, { kind: "" }).kind });
  if (!reachable(run).includes(nodeId)) throw err("node_unreachable", "You can't reach that place from here.", { reachable: reachable(run) });
  const node = nodeOf(actMap(run), nodeId);
  if (node && FIGHT_KINDS.includes(node.kind)) {
    const other = await ctx.db.select({ id: arenaBattles.id }).from(arenaBattles).where(and(eq(arenaBattles.userId, run.userId), eq(arenaBattles.sessionId, run.sessionId), eq(arenaBattles.status, "active"))).get();
    if (other) throw err("battle_in_progress", "You already have a battle running for this document. Finish or forfeit it first.", { battle_id: other.id });
  }
}

/** Validate a move (no side effects). For a fight: the boss to make. */
export async function planTravel(ctx: RequestContext, userId: number, runId: string, nodeId: string) {
  const run = await need(ctx, runId, userId);
  await checkCanTravel(ctx, run, nodeId);
  const node = nodeOf(actMap(run), nodeId)!;
  const fight = FIGHT_KINDS.includes(node.kind);
  return { node, fight, ...(fight ? await fightPlan(ctx, run, node) : { topic: null, difficulty: run.difficulty, targets: null }) };
}

const rngFor = (run: Run, nodeId: string, purpose: string) => seeded(`expedition:${run.seed}:${nodeId}:${purpose}:${run.depth}`);

function offer(run: Run, rng: ReturnType<typeof seeded>, n: number): string[] {
  const owned = new Set(J<string[]>(run.relicsJson, []));
  const pool = RELICS.relics.filter((r) => !owned.has(r.id));
  const picked: string[] = [];
  while (pool.length && picked.length < n) {
    const r = rng.weighted(pool, pool.map((p) => Number(p.weight)));
    picked.push(r.id);
    pool.splice(pool.indexOf(r), 1);
  }
  return picked;
}

async function grantRelic(ctx: RequestContext, runId: string, relicId: string) {
  const run = (await runRow(ctx, runId))!;
  const relics = J<string[]>(run.relicsJson, []);
  if (relics.includes(relicId)) return;
  relics.push(relicId);
  const extra = relicId === "iron_will" ? IRON_WILL_HEARTS : 0;
  await ctx.db.update(arenaRuns).set({ relicsJson: JSON.stringify(relics), maxHearts: sql`${arenaRuns.maxHearts} + ${extra}`, hearts: sql`${arenaRuns.hearts} + ${extra}`, updatedAt: iso() }).where(eq(arenaRuns.id, runId));
}

const score = (ctx: RequestContext, runId: string, points: number, depth = 0) =>
  ctx.db.update(arenaRuns).set({ score: sql`${arenaRuns.score} + ${points}`, depth: sql`${arenaRuns.depth} + ${depth}` }).where(eq(arenaRuns.id, runId));
const setPending = (ctx: RequestContext, runId: string, pending: unknown) =>
  ctx.db.update(arenaRuns).set({ pendingJson: pending ? JSON.stringify(pending) : null, updatedAt: iso() }).where(eq(arenaRuns.id, runId));
const restHeal = (run: Run) => Math.max(0, Math.min(Math.ceil(run.maxHearts * REST_HEAL_PCT), run.maxHearts - run.hearts));

async function pendingFor(ctx: RequestContext, run: Run, node: Node) {
  if (node.kind === "rest") {
    const concepts = (await weakConcepts(ctx, run.userId, run.docHash, 5)).map((c) => c.concept);
    return { kind: "rest", node_id: node.id, heal: restHeal(run), concepts, options: ["heal", ...(concepts.length ? ["study"] : [])] };
  }
  const cat = relicCatalog();
  const stock: Record<string, unknown>[] = offer(run, rngFor(run, node.id, "shop"), SHOP_RELICS).map((r) => ({ id: r, kind: "relic", ...publicRelic(r), price: cat.get(r)!.price, sold: false }));
  stock.push({ id: POTION.id, kind: POTION.kind, name: POTION.name, description: POTION.description, price: POTION.price, sold: false });
  return { kind: "shop", node_id: node.id, stock };
}

/** Move to a reachable node. A fight node needs `boss` (made by the caller first). */
export async function travel(ctx: RequestContext, userId: number, runId: string, nodeId: string, boss: Boss | null) {
  const run = await need(ctx, runId, userId);
  await checkCanTravel(ctx, run, nodeId);
  const node = nodeOf(actMap(run), nodeId)!;
  const visited = [...J<string[]>(run.visitedJson, []), nodeId];
  const moved = await ctx.db.update(arenaRuns).set({ nodeId, visitedJson: JSON.stringify(visited), updatedAt: iso() })
    .where(and(eq(arenaRuns.id, run.id), eq(arenaRuns.status, "active"), sql`${arenaRuns.battleId} IS NULL`, sql`${arenaRuns.pendingJson} IS NULL`,
      sql`COALESCE(${arenaRuns.nodeId}, '') = ${run.nodeId ?? ""}`)).returning({ id: arenaRuns.id }).all();
  if (!moved.length) throw err("node_unreachable", "You can't reach that place from here.");
  const out: Record<string, unknown> = { node };
  if (FIGHT_KINDS.includes(node.kind)) {
    if (!boss) throw new Error("a fight node needs a boss");
    const plan = await fightPlan(ctx, run, node);
    const flags = J<Record<string, unknown>>(run.flagsJson, {});
    const battle = await createBattle(ctx, userId, {
      sessionId: run.sessionId, docHash: run.docHash, topic: plan.topic, difficulty: plan.difficulty, boss, mode: "expedition", runId: run.id,
      hearts: run.hearts, maxHearts: run.maxHearts, mods: { relics: J(run.relicsJson, []), phoenix_used: !!flags.phoenix_used, focus_bonus: run.actFocusBonus, node_kind: node.kind },
      hpScale: HP_SCALE[node.kind], targets: plan.targets, focusCap: run.focusCap,
    });
    await ctx.db.update(arenaRuns).set({ battleId: battle.id }).where(eq(arenaRuns.id, run.id));
    Object.assign(out, { battle_id: battle.id, boss: publicBoss(battle), battle: battleState(battle) });
  } else if (node.kind === "treasure") {
    const found = offer(run, rngFor(run, node.id, "treasure"), 1);
    await score(ctx, run.id, POINTS.treasure, 1);
    if (!found.length) { await ctx.db.update(arenaRuns).set({ gold: sql`${arenaRuns.gold} + ${TREASURE_FALLBACK_GOLD}` }).where(eq(arenaRuns.id, run.id)); out.gained = { relic: null, gold: TREASURE_FALLBACK_GOLD }; }
    else { await grantRelic(ctx, run.id, found[0]); out.gained = { relic: publicRelic(found[0]), gold: 0 }; }
  } else await setPending(ctx, run.id, await pendingFor(ctx, run, node));
  return { ...out, run: await state(ctx, await need(ctx, runId, userId)) };
}

// ── choices ──────────────────────────────────────────────────────────────────────────────────────────────────
const badAction = (pending: { kind: string }, allowed: string[]) => new HttpError(400, "invalid_choice", `Choose one of: ${allowed.join(", ")}.`, null, { pending: pending.kind });

async function nextAct(ctx: RequestContext, runId: string) {
  await ctx.db.update(arenaRuns).set({ act: sql`${arenaRuns.act} + 1`, nodeId: null, actFocusBonus: 0, updatedAt: iso() }).where(and(eq(arenaRuns.id, runId), sql`${arenaRuns.act} < ${ACTS}`));
}

export async function choose(ctx: RequestContext, userId: number, runId: string, action: unknown, target: unknown) {
  const run = await need(ctx, runId, userId);
  if (run.status !== "active") throw err("run_finished", "That expedition is over.");
  if (!run.pendingJson) throw err("no_choice", "There is nothing to choose right now.");
  const pending = J<Record<string, any>>(run.pendingJson, {});
  const t = typeof target === "string" ? target : null;
  let outcome: Record<string, unknown>;
  if (pending.kind === "rest") {
    if (action === "heal") {
      const healed = restHeal(run);
      await ctx.db.update(arenaRuns).set({ hearts: sql`${arenaRuns.hearts} + ${healed}` }).where(eq(arenaRuns.id, run.id));
      outcome = { action: "heal", healed };
    } else if (action === "study") {
      const concept = (pending.concepts ?? []).find((c: string) => t && c.toLowerCase() === t.trim().toLowerCase());
      if (!concept) throw new HttpError(400, "invalid_choice", "Pick one of the concepts on offer to study.", null, { concepts: pending.concepts ?? [] });
      await ctx.db.update(arenaRuns).set({ actFocusBonus: sql`${arenaRuns.actFocusBonus} + 1` }).where(eq(arenaRuns.id, run.id));
      const review = (await ctx.db.select().from(missedQuestions).where(and(eq(missedQuestions.userId, run.userId), eq(missedQuestions.docHash, run.docHash), eq(missedQuestions.conceptKey, conceptKey(concept))))
        .orderBy(desc(missedQuestions.missedAt)).limit(5).all()).map((r) => ({ question: r.question, correct_answer: r.correctAnswer, explanation: r.explanation }));
      outcome = { action: "study", concept, review, act_focus_bonus: run.actFocusBonus + 1 };
    } else throw badAction(pending as { kind: string }, pending.options ?? ["heal"]);
    await score(ctx, run.id, POINTS.rest, 1);
    await setPending(ctx, run.id, null);
  } else if (pending.kind === "shop") {
    if (action === "leave") { await score(ctx, run.id, POINTS.shop, 1); await setPending(ctx, run.id, null); outcome = { action: "leave" }; }
    else if (action !== "buy") throw badAction(pending as { kind: string }, ["buy", "leave"]);
    else {
      const item = (pending.stock ?? []).find((i: Record<string, unknown>) => i.id === t);
      if (!item) throw new HttpError(400, "invalid_choice", "That isn't for sale here.");
      if (item.sold) throw err("sold_out", "You already bought that.");
      if (run.gold < item.price) throw err("not_enough_gold", "You don't have enough gold.", { gold: run.gold, price: item.price });
      const paid = await ctx.db.update(arenaRuns).set({ gold: sql`${arenaRuns.gold} - ${item.price}` }).where(and(eq(arenaRuns.id, run.id), sql`${arenaRuns.gold} >= ${item.price}`)).returning({ id: arenaRuns.id }).all();
      if (!paid.length) throw err("not_enough_gold", "You don't have enough gold.");
      outcome = { action: "buy", item: t, price: item.price };
      if (item.kind === "potion") {
        const healed = Math.max(0, Math.min(POTION.heal, run.maxHearts - run.hearts));
        await ctx.db.update(arenaRuns).set({ hearts: sql`${arenaRuns.hearts} + ${healed}` }).where(eq(arenaRuns.id, run.id));
        outcome.healed = healed;
      } else { await grantRelic(ctx, run.id, t!); outcome.relic = publicRelic(t!); }
      item.sold = true;
      await setPending(ctx, run.id, pending);
    }
  } else {
    if (action === "take") {
      if (!(pending.options ?? []).includes(t)) throw new HttpError(400, "invalid_choice", "Pick one of the relics on offer.");
      await grantRelic(ctx, run.id, t!);
      outcome = { action: "take", relic: publicRelic(t!) };
    } else if (action === "skip") outcome = { action: "skip" };
    else throw badAction(pending as { kind: string }, ["take", "skip"]);
    await setPending(ctx, run.id, null);
    if (pending.then === "next_act") { await nextAct(ctx, run.id); outcome.next_act = true; }
  }
  return { run: await state(ctx, await need(ctx, runId, userId)), outcome };
}

// ── endings ──────────────────────────────────────────────────────────────────────────────────────────────────
export const rewardScale = (depth: number, won: boolean) => Math.round(Math.min(2, 0.8 + 0.08 * depth + (won ? 0.3 : 0)) * 100) / 100;

/** End a run ONCE: status, final score and the single expedition_complete reward. */
async function finish(ctx: RequestContext, player: Player, runId: string, status: string) {
  const run = await runRow(ctx, runId);
  if (!run || run.status !== "active") return null;
  const now = iso();
  const bonus = status === "won" ? WIN_BONUS + HEART_POINTS * run.hearts : 0;
  const won = await ctx.db.update(arenaRuns).set({ status, score: sql`${arenaRuns.score} + ${bonus}`, pendingJson: null, finishedAt: now, updatedAt: now })
    .where(and(eq(arenaRuns.id, runId), eq(arenaRuns.status, "active"))).returning({ id: arenaRuns.id }).all();
  if (!won.length) return null;
  const accuracy = run.answered ? run.correct / run.answered : 0;
  const paid: Record<string, unknown> = { expedition_complete: null };
  if (run.depth > 0) paid.expedition_complete = await award(ctx, player, "expedition_complete", { accuracy, difficulty: rewardScale(run.depth, status === "won"), combo: 1, sourceId: runId });
  const result = { status, score: run.score + bonus, depth: run.depth, act: run.act, battles_won: run.battlesWon, accuracy: Math.round(100 * accuracy) };
  await ctx.db.update(arenaRuns).set({ rewardsJson: JSON.stringify(paid), resultJson: JSON.stringify(result) }).where(eq(arenaRuns.id, runId));
  return paid;
}

async function finalSummary(ctx: RequestContext, runId: string, paid: unknown) {
  const run = (await runRow(ctx, runId))!;
  return { run_id: runId, status: run.status, score: run.score, result: J(run.resultJson, {}), rewards: paid ?? J(run.rewardsJson, null) };
}

/** A run battle just ended (once per battle): hearts, gold, Phoenix Ash, the relic offer, the next act or the end. */
async function battleEnded(ctx: RequestContext, player: Player, b: typeof arenaBattles.$inferSelect, status: string) {
  let run = await runRow(ctx, b.runId!);
  if (!run || run.status !== "active" || run.battleId !== b.id) return null;
  const mods = J<Boss>(b.bossJson, {}).mods ?? {};
  const kind = mods.node_kind ?? "battle";
  const flags = J<Record<string, unknown>>(run.flagsJson, {});
  if (mods.phoenix_used) flags.phoenix_used = true;
  const relics = new Set(J<string[]>(run.relicsJson, []));
  await ctx.db.update(arenaRuns).set({ battleId: null, hearts: status === "won" ? Math.max(0, b.playerHp) : 0, flagsJson: JSON.stringify(flags),
    answered: sql`${arenaRuns.answered} + ${b.answered}`, correct: sql`${arenaRuns.correct} + ${b.correct}`, updatedAt: iso() }).where(eq(arenaRuns.id, run.id));
  if (status !== "won") return finalSummary(ctx, run.id, await finish(ctx, player, run.id, "lost"));
  const gold = Math.round((GOLD[kind] ?? GOLD.battle) * (relics.has("lucky_coin") ? LUCKY_COIN : 1));
  await ctx.db.update(arenaRuns).set({ gold: sql`${arenaRuns.gold} + ${gold}`, battlesWon: sql`${arenaRuns.battlesWon} + 1` }).where(eq(arenaRuns.id, run.id));
  await score(ctx, run.id, POINTS[kind] ?? POINTS.battle, 1);
  const summary: Record<string, unknown> = { run_id: run.id, status: "active", gold_gained: gold, pending: null };
  if (kind === "boss" && run.act >= ACTS) return { ...summary, ...(await finalSummary(ctx, run.id, await finish(ctx, player, run.id, "won"))) };
  if (kind === "elite" || kind === "boss") {
    run = (await runRow(ctx, run.id))!;
    const options = offer(run, rngFor(run, run.nodeId!, "relic"), RELIC_CHOICES);
    if (options.length) {
      await setPending(ctx, run.id, { kind: "relic", node_id: run.nodeId, options, relics: options.map(publicRelic), then: kind === "boss" ? "next_act" : null });
      summary.pending = "relic";
    } else if (kind === "boss") await nextAct(ctx, run.id);
  }
  return summary;
}
setRunBattleEnd(battleEnded);

/** Give up: the run ends as abandoned (paying for its depth) and a fight in progress is lost. */
export async function abandon(ctx: RequestContext, player: Player, runId: string) {
  let run = await need(ctx, runId, player.id);
  if (run.status === "active" && run.battleId) {
    const b = await ctx.db.select({ answered: arenaBattles.answered, correct: arenaBattles.correct }).from(arenaBattles).where(and(eq(arenaBattles.id, run.battleId), eq(arenaBattles.status, "active"))).get();
    if (b) await ctx.db.update(arenaRuns).set({ answered: sql`${arenaRuns.answered} + ${b.answered}`, correct: sql`${arenaRuns.correct} + ${b.correct}` }).where(eq(arenaRuns.id, run.id));
  }
  await finish(ctx, player, run.id, "abandoned");
  if (run.battleId) {
    await endBattle(ctx, player, run.battleId, "lost");
    await ctx.db.update(arenaRuns).set({ battleId: null }).where(eq(arenaRuns.id, run.id));
  }
  run = await need(ctx, runId, player.id);
  return { ok: true, run: await state(ctx, run) };
}

/** Each player's best finished run: on one document (all time) or global (this week). */
export async function leaderboard(ctx: RequestContext, userId: number, scope: "document" | "global", docHash: string | null) {
  const where = scope === "global" ? sql`r.status != 'active' AND r.finished_at >= ${weekStart().toISOString()}` : sql`r.status != 'active' AND r.doc_hash = ${docHash}`;
  const rows = await ctx.db.all<{ user_id: number; username: string | null; score: number; depth: number; act: number; status: string; difficulty: string; finished_at: string | null }>(sql`
    SELECT * FROM (SELECT r.*, u.username AS username, ROW_NUMBER() OVER (PARTITION BY r.user_id ORDER BY r.score DESC, r.finished_at ASC) AS rn
      FROM arena_runs r JOIN user u ON u.id = r.user_id WHERE ${where}) WHERE rn = 1 ORDER BY score DESC, finished_at ASC LIMIT 100`);
  return rows.map((r, i) => ({ rank: i + 1, username: r.username || String(r.user_id).slice(0, 8), score: r.score, depth: r.depth, act: r.act, status: r.status,
    difficulty: r.difficulty, date: (r.finished_at ?? "").slice(0, 10), is_me: r.user_id === userId }));
}
