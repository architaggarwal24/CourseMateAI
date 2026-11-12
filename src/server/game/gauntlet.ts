// Boss Rush and Survival (Stage 6): fights in a row on one topic, your hearts carried from one to the next (a knock-down
// still offers CONTINUE). Each fight is an ordinary arena battle that pays as usual; this keeps the run of them.
//   Boss Rush  the three strongest creatures you have hunted, weakest first, each a little stronger than your power
//              level; beat all three for the big chest.
//   Survival   bosses without end, each matched to your power level and a step stronger than the last; a chest every
//              5 bosses. It ends when a fight is lost.
// Every boss is matched to the power level the run started with (power.ts).
import { and, desc, eq, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { arenaBattles, arenaGauntlets } from "../db/schema";
import { HttpError } from "../http";
import * as arena from "./arena";
import { CREATURES } from "./bestiary";
import { openGauntletChest, type GauntletChest } from "./chest";
import * as kits from "./kits";
import { matchBoss, powerLevel, type Match } from "./power";
import { getAvatar, type Player } from "./store";

export type GauntletKind = "rush" | "survival";
export const RUSH_BOSSES = 3;
/** Boss Rush: each boss's power, x your power level. */
export const RUSH_STEPS = [0.9, 1.05, 1.2];
/** Survival: the first boss at 70% of your power, each next one 12% more. */
export const SURVIVAL_START = 0.7, SURVIVAL_STEP = 0.12;
export const CHEST_EVERY = 5;
const NEMESIS = "ammit";
const bossById = (species: string) => CREATURES[species]?.name ?? species;

type Row = typeof arenaGauntlets.$inferSelect;
const iso = () => new Date().toISOString();
const J = <T,>(s: string | null | undefined, d: T): T => { if (!s) return d; try { return JSON.parse(s) as T; } catch { return d; } };
const err = (code: string, message: string, details: Record<string, unknown> | null = null, status = 409) => new HttpError(status, code, message, null, details);

async function need(ctx: RequestContext, id: string, userId: number): Promise<Row> {
  const g = await ctx.db.select().from(arenaGauntlets).where(and(eq(arenaGauntlets.id, String(id)), eq(arenaGauntlets.userId, userId))).get();
  if (!g) throw new HttpError(404, "gauntlet_not_found", "We couldn't find that run of fights.");
  return g;
}

export async function findActive(ctx: RequestContext, userId: number, sessionId?: string | null) {
  return (await ctx.db.select().from(arenaGauntlets).where(and(eq(arenaGauntlets.userId, userId), eq(arenaGauntlets.status, "active"),
    ...(sessionId ? [eq(arenaGauntlets.sessionId, sessionId)] : []))).orderBy(desc(arenaGauntlets.createdAt)).get()) ?? null;
}

/** Survival's next boss: matched to its power, never the same creature twice in a row. */
export function survivalTarget(power: number, stage: number) { return Math.round(power * (SURVIVAL_START + SURVIVAL_STEP * stage)); }

function nextBoss(g: Row, open: Set<string>): Match {
  if (g.kind === "rush") return J<Match[]>(g.planJson, [])[g.stage];
  const pool = [...open].filter((s) => s !== NEMESIS && s !== g.lastSpecies);
  return matchBoss(survivalTarget(g.power, g.stage), pool.length ? pool : [...open].filter((s) => s !== NEMESIS));
}

/** Boss Rush's plan: your three strongest hunted creatures, weakest first, each matched to a step of your power. */
export function rushPlan(power: number, hunted: string[]): Match[] {
  const three = hunted.slice(0, RUSH_BOSSES).reverse();
  return three.map((species, i) => matchBoss(Math.round(power * RUSH_STEPS[i]), [species]));
}

export function state(g: Row) {
  const plan = J<Match[]>(g.planJson, []);
  const out: Record<string, unknown> = {
    gauntlet_id: g.id, kind: g.kind, status: g.status, topic: g.topic, session_id: g.sessionId, power: g.power, stage: g.stage,
    hearts: g.hearts, max_hearts: g.maxHearts, battle_id: g.battleId, score: g.score, chests: J<GauntletChest[]>(g.chestsJson, []),
    answered: g.answered, correct: g.correct,
  };
  if (g.kind === "rush") {
    out.bosses_total = RUSH_BOSSES;
    out.plan = plan.map((m, i) => ({ species: m.species, name: bossById(m.species), difficulty: m.difficulty, power: m.power, beaten: i < g.stage }));
  } else {
    out.next_power = survivalTarget(g.power, g.stage);
    out.next_chest_at = (Math.floor(g.stage / CHEST_EVERY) + 1) * CHEST_EVERY;
  }
  if (g.status !== "active") out.result = J(g.resultJson, {});
  return out;
}

/** The hub's view: your power level, whether Boss Rush is open (3 creatures hunted), your bests, a run in progress. */
export async function overview(ctx: RequestContext, userId: number, sessionId: string | null) {
  const p = await powerLevel(ctx, userId);
  const best = async (kind: GauntletKind) => (await ctx.db.select({ stage: arenaGauntlets.stage, score: arenaGauntlets.score }).from(arenaGauntlets)
    .where(and(eq(arenaGauntlets.userId, userId), eq(arenaGauntlets.kind, kind), sql`${arenaGauntlets.status} != 'active'`))
    .orderBy(desc(arenaGauntlets.stage), desc(arenaGauntlets.score)).get()) ?? null;
  const rushWins = (await ctx.db.select({ n: sql<number>`count(*)` }).from(arenaGauntlets)
    .where(and(eq(arenaGauntlets.userId, userId), eq(arenaGauntlets.kind, "rush"), eq(arenaGauntlets.status, "won"))).get())?.n ?? 0;
  const active = await findActive(ctx, userId, sessionId);
  return {
    ok: true, power: p,
    rush: { unlocked: p.hunted.length >= RUSH_BOSSES, hunted: p.hunted.length, need: RUSH_BOSSES, bosses: p.hunted.slice(0, RUSH_BOSSES).map((s) => ({ species: s, name: bossById(s) })), wins: rushWins, best: await best("rush") },
    survival: { best: await best("survival") },
    active: active ? state(active) : null,
  };
}

/** Start a Boss Rush or a Survival on a topic; its first fight is made at once (its questions written by .../prepare). */
export async function create(ctx: RequestContext, userId: number, o: { kind: GauntletKind; sessionId: string; docHash: string; topic: string }) {
  if (await findActive(ctx, userId, o.sessionId)) throw err("gauntlet_in_progress", "You already have a Boss Rush or Survival running on this document. Finish or give it up first.");
  if (await arena.findActive(ctx, userId, o.sessionId)) throw err("battle_in_progress", "You already have a battle running for this document. Finish or forfeit it first.");
  const p = await powerLevel(ctx, userId);
  let plan: Match[] = [];
  if (o.kind === "rush") {
    if (p.hunted.length < RUSH_BOSSES) throw err("rush_locked", `Hunt ${RUSH_BOSSES} different creatures to open Boss Rush.`, { hunted: p.hunted.length, need: RUSH_BOSSES });
    plan = rushPlan(p.power, p.hunted);
  }
  const av = await getAvatar(ctx, userId);
  const hearts = kits.heartsFor(av.championId, arena.PLAYER_MAX_HP + arena.gearFor(av.equipped).hp);
  const id = crypto.randomUUID().replace(/-/g, "");
  const now = iso();
  try {
    await ctx.db.insert(arenaGauntlets).values({ id, userId, sessionId: o.sessionId, docHash: o.docHash, kind: o.kind, topic: o.topic, power: p.power,
      planJson: JSON.stringify(plan), hearts, maxHearts: hearts, createdAt: now, updatedAt: now });
  } catch (e) {
    if (String((e as Error)?.message ?? e).includes("UNIQUE")) throw err("gauntlet_in_progress", "You already have a Boss Rush or Survival running on this document.");
    throw e;
  }
  return startFight(ctx, userId, await need(ctx, id, userId));
}

/** The next fight (after a win). Its hearts are the ones the last fight left you. */
export async function next(ctx: RequestContext, userId: number, id: string) {
  const g = await need(ctx, id, userId);
  if (g.status !== "active") throw err("gauntlet_finished", "That run of fights is over.");
  if (g.battleId) {
    const b = await arena.getBattle(ctx, userId, g.battleId);
    if (b.status === "active") return { gauntlet: state(g), battle_id: b.id, boss: arena.publicBoss(b), battle: arena.state(b) };
  }
  return startFight(ctx, userId, g);
}

async function startFight(ctx: RequestContext, userId: number, g: Row) {
  const pick = nextBoss(g, await arena.summonable(ctx, userId));
  const boss = await arena.newBoss(g.topic, pick.difficulty, null, pick.species);
  const carried = g.stage > 0;
  const b = await arena.createBattle(ctx, userId, {
    sessionId: g.sessionId, docHash: g.docHash, topic: g.topic, difficulty: pick.difficulty, boss, mode: g.kind, gauntletId: g.id,
    hearts: carried ? g.hearts : null, maxHearts: carried ? g.maxHearts : null, hpScale: pick.hp_scale,
  });
  const claimed = await ctx.db.update(arenaGauntlets).set({ battleId: b.id, lastSpecies: pick.species, updatedAt: iso() })
    .where(and(eq(arenaGauntlets.id, g.id), eq(arenaGauntlets.status, "active"), eq(arenaGauntlets.stage, g.stage))).returning({ id: arenaGauntlets.id }).all();
  if (!claimed.length) {
    await ctx.db.delete(arenaBattles).where(eq(arenaBattles.id, b.id));
    throw err("gauntlet_busy", "That run of fights changed meanwhile. Try again.");
  }
  return { gauntlet: state(await need(ctx, g.id, userId)), battle_id: b.id, boss: arena.publicBoss(b), battle: arena.state(b) };
}

/** End the run ONCE (compare-and-set): its result. */
async function finish(ctx: RequestContext, g: Row, status: "won" | "lost" | "abandoned") {
  const now = iso();
  const fresh = (await ctx.db.select().from(arenaGauntlets).where(eq(arenaGauntlets.id, g.id)).get())!;
  const result = { status, stage: fresh.stage, score: fresh.score, power: fresh.power, chests: J<GauntletChest[]>(fresh.chestsJson, []).length,
    accuracy: fresh.answered ? Math.round((100 * fresh.correct) / fresh.answered) : 0 };
  const done = await ctx.db.update(arenaGauntlets).set({ status, battleId: null, resultJson: JSON.stringify(result), finishedAt: now, updatedAt: now })
    .where(and(eq(arenaGauntlets.id, g.id), eq(arenaGauntlets.status, "active"))).returning({ id: arenaGauntlets.id }).all();
  return done.length ? result : null;
}

/**
 * A fight of the run just ended (once per battle; the arena calls this): hearts and score carried, a chest when one is
 * due, and the run's end (Boss Rush beaten, or a fight lost). What it says goes on the battle's result.
 */
async function battleEnded(ctx: RequestContext, player: Player, b: typeof arenaBattles.$inferSelect, status: string) {
  const g = await ctx.db.select().from(arenaGauntlets).where(eq(arenaGauntlets.id, b.gauntletId!)).get();
  if (!g || g.status !== "active" || g.battleId !== b.id) return null;
  const total = Number(J<{ score?: { total?: number } }>(b.resultJson, {}).score?.total ?? 0);
  const won = status === "won";
  const stage = g.stage + (won ? 1 : 0);
  await ctx.db.update(arenaGauntlets).set({
    stage, hearts: won ? Math.max(1, b.playerHp) : 0, maxHearts: b.playerMaxHp, battleId: won ? null : g.battleId,
    score: sql`${arenaGauntlets.score} + ${total}`, answered: sql`${arenaGauntlets.answered} + ${b.answered}`, correct: sql`${arenaGauntlets.correct} + ${b.correct}`,
    updatedAt: iso(),
  }).where(eq(arenaGauntlets.id, g.id));
  const out: Record<string, unknown> = { gauntlet_id: g.id, kind: g.kind, stage, over: false, status: "active", chest: null };
  let chest: GauntletChest | null = null;
  const rushDone = g.kind === "rush" && won && stage >= RUSH_BOSSES;
  if (rushDone) chest = await openGauntletChest(ctx, player, "big", `${g.id}:big`);
  else if (g.kind === "survival" && won && stage % CHEST_EVERY === 0) chest = await openGauntletChest(ctx, player, "chest", `${g.id}:${stage}`);
  if (chest) {
    const chests = [...J<GauntletChest[]>(g.chestsJson, []), { ...chest, at: stage }];
    await ctx.db.update(arenaGauntlets).set({ chestsJson: JSON.stringify(chests) }).where(eq(arenaGauntlets.id, g.id));
    out.chest = { ...chest, at: stage };
  }
  if (rushDone || !won) {
    const result = await finish(ctx, g, rushDone ? "won" : "lost");
    Object.assign(out, { over: true, status: rushDone ? "won" : "lost", result });
  } else {
    const after = (await ctx.db.select().from(arenaGauntlets).where(eq(arenaGauntlets.id, g.id)).get())!;
    out.next = g.kind === "rush" ? { ...J<Match[]>(after.planJson, [])[stage], name: bossById(J<Match[]>(after.planJson, [])[stage].species) } : { power: survivalTarget(after.power, stage) };
    if (g.kind === "survival") out.next_chest_at = (Math.floor(stage / CHEST_EVERY) + 1) * CHEST_EVERY;
  }
  return out;
}
arena.setGauntletBattleEnd(battleEnded);

/** Give up: the run ends (chests already won are kept) and a fight in progress is lost. */
export async function abandon(ctx: RequestContext, player: Player, id: string) {
  const g = await need(ctx, id, player.id);
  if (g.status === "active") {
    if (g.battleId) await arena.end(ctx, player, g.battleId, "lost");       // ends the run too (a lost fight)
    const still = await need(ctx, id, player.id);
    if (still.status === "active") await finish(ctx, still, "abandoned");
  }
  return { ok: true, gauntlet: state(await need(ctx, id, player.id)) };
}

export const get = async (ctx: RequestContext, userId: number, id: string) => state(await need(ctx, id, userId));
