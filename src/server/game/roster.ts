// Champion unlocks (Stage C1). Kaien is free. Finishing a Bestiary tier (every creature in it beaten) brings the
// next champion: I Asha, II Brak, III Mira, IV Vex. Thorne joins at player level 25. Anyone who picked a champion
// before the locks keeps it. Each new champion arrives with a ceremony that pays its reward once.
import { and, eq, isNull } from "drizzle-orm";
import type { RequestContext } from "../context";
import { bestiaryRecords, championProgress, championUnlocks, userProgress } from "../db/schema";
import { HttpError } from "../http";
import { CHAMPIONS, type Champion } from "./content";
import { recordRewardEvent, nowIso } from "./store";
import { NEMESIS_SPECIES } from "./bestiary";
import { TIER_OF, finishedTiers, tierFinished, type RecordRow } from "./tome";

export type Unlock = { kind: "free" } | { kind: "tier"; tier: 1 | 2 | 3 | 4 } | { kind: "level"; level: number };

export const THORNE_LEVEL = 25;
export const UNLOCKS: Record<Champion, Unlock> = {
  kaien: { kind: "free" },
  asha: { kind: "tier", tier: 1 },
  brak: { kind: "tier", tier: 2 },
  mira: { kind: "tier", tier: 3 },
  vex: { kind: "tier", tier: 4 },
  thorne: { kind: "level", level: THORNE_LEVEL },
};
const ROMAN = ["", "I", "II", "III", "IV"];

/** What the ceremony pays (once, by its ledger key). */
export const UNLOCK_REWARD: Record<Champion, { xp: number; coins: number }> = {
  kaien: { xp: 0, coins: 0 },
  asha: { xp: 150, coins: 100 },
  brak: { xp: 250, coins: 150 },
  mira: { xp: 400, coins: 250 },
  vex: { xp: 600, coins: 400 },
  thorne: { xp: 500, coins: 300 },
};

/** The champion a finished tier brings. */
export const championForTier = (tier: number): Champion | null =>
  (Object.keys(UNLOCKS) as Champion[]).find((c) => { const u = UNLOCKS[c]; return u.kind === "tier" && u.tier === tier; }) ?? null;

/** The champions whose condition is met now (Kaien always). */
export function earned(recs: Map<string, RecordRow>, level: number): Set<Champion> {
  const out = new Set<Champion>(["kaien"]);
  const done = new Set<number>(finishedTiers(recs));
  for (const c of CHAMPIONS) {
    const u = UNLOCKS[c];
    if (u.kind === "tier" && done.has(u.tier)) out.add(c);
    if (u.kind === "level" && level >= u.level) out.add(c);
  }
  return out;
}

/** How far along the condition is: creatures of the tier beaten, or levels reached. */
export function unlockProgress(c: Champion, recs: Map<string, RecordRow>, level: number) {
  const u = UNLOCKS[c];
  if (u.kind === "free") return { how: "Free", have: 1, need: 1 };
  if (u.kind === "level") return { how: `Reach level ${u.level}`, have: Math.min(level, u.level), need: u.level };
  const members = Object.keys(TIER_OF).filter((s) => TIER_OF[s] === u.tier && s !== NEMESIS_SPECIES);
  const have = members.filter((s) => (recs.get(s)?.wins ?? 0) > 0).length;
  return { how: `Beat every creature in Bestiary tier ${ROMAN[u.tier]}`, have: tierFinished(recs, u.tier) ? members.length : have, need: members.length };
}

type UnlockRow = typeof championUnlocks.$inferSelect;

/** One round trip: the reads the roster needs (records, level, unlock rows, and each champion's level). */
export async function rosterReads(ctx: RequestContext, userId: number) {
  const [recRows, prog, rows, levels] = await ctx.db.batch([
    ctx.db.select().from(bestiaryRecords).where(eq(bestiaryRecords.userId, userId)),
    ctx.db.select({ level: userProgress.currentLevel }).from(userProgress).where(eq(userProgress.userId, userId)),
    ctx.db.select().from(championUnlocks).where(eq(championUnlocks.userId, userId)),
    ctx.db.select().from(championProgress).where(eq(championProgress.userId, userId)),
  ]);
  return {
    recs: new Map(recRows.map((r) => [r.species, r])), level: prog[0]?.level ?? 1,
    rows: new Map(rows.map((r) => [r.championId, r])), levels: new Map(levels.map((r) => [r.championId, r])),
  };
}

/**
 * Write the unlocks that are due and missing (one statement per new champion, in one batch): earned ones wait for
 * their ceremony; `kept` (the champion already worn) needs none. Returns the rows as they are now.
 */
export async function grantDue(ctx: RequestContext, userId: number, r: { recs: Map<string, RecordRow>; level: number; rows: Map<string, UnlockRow> }, kept: string | null) {
  const t = nowIso();
  const fresh: UnlockRow[] = [];
  for (const c of earned(r.recs, r.level)) {
    if (c === "kaien" || r.rows.has(c)) continue;
    const u = UNLOCKS[c];
    fresh.push({ userId, championId: c, source: u.kind === "tier" ? `tier${u.tier}` : "level", unlockedAt: t, celebratedAt: null });
  }
  if (kept && kept !== "kaien" && (CHAMPIONS as readonly string[]).includes(kept) && !r.rows.has(kept) && !fresh.some((f) => f.championId === kept)) {
    fresh.push({ userId, championId: kept, source: "kept", unlockedAt: t, celebratedAt: t });
  }
  if (fresh.length) {
    const stmts = fresh.map((f) => ctx.db.insert(championUnlocks).values(f).onConflictDoNothing());
    await ctx.db.batch(stmts as [typeof stmts[0], ...typeof stmts]);
    for (const f of fresh) r.rows.set(f.championId, f);
  }
  return r.rows;
}

/** After a fight: the champions the tiers it finished bring (written now; the ceremony happens on screen). */
export async function grantForTiers(ctx: RequestContext, userId: number, tiers: number[]): Promise<Champion[]> {
  const out: Champion[] = [];
  const t = nowIso();
  for (const tier of tiers) {
    const c = championForTier(tier);
    if (!c) continue;
    const done = await ctx.db.insert(championUnlocks).values({ userId, championId: c, source: `tier${tier}`, unlockedAt: t })
      .onConflictDoNothing().returning({ c: championUnlocks.championId }).all();
    if (done.length) out.push(c);
  }
  return out;
}

export const isUnlocked = (c: string, rows: Map<string, UnlockRow>) => c === "kaien" || rows.has(c);

/** The roster as the Champion tab shows it, per champion. */
export function rosterView(r: { recs: Map<string, RecordRow>; level: number; rows: Map<string, UnlockRow> }) {
  return Object.fromEntries(CHAMPIONS.map((c) => {
    const row = r.rows.get(c);
    const unlocked = isUnlocked(c, r.rows);
    return [c, {
      unlocked, source: c === "kaien" ? "free" : row?.source ?? null,
      celebrated: c === "kaien" || !!row?.celebratedAt,
      ...unlockProgress(c, r.recs, r.level),
      reward: UNLOCK_REWARD[c],
    }];
  }));
}

/** The ceremony: mark it seen and pay its reward, once. A second call pays nothing. */
export async function celebrate(ctx: RequestContext, userId: number, champion: unknown) {
  if (typeof champion !== "string" || !(CHAMPIONS as readonly string[]).includes(champion)) {
    throw new HttpError(422, "unknown_champion", "That champion doesn't exist.");
  }
  const c = champion as Champion;
  if (c === "kaien") return { champion_id: c, reward: { xp: 0, coins: 0 }, first: false };
  const marked = await ctx.db.update(championUnlocks).set({ celebratedAt: nowIso() })
    .where(and(eq(championUnlocks.userId, userId), eq(championUnlocks.championId, c), isNull(championUnlocks.celebratedAt)))
    .returning({ c: championUnlocks.championId }).all();
  if (!marked.length) {
    const has = await ctx.db.select({ c: championUnlocks.championId }).from(championUnlocks)
      .where(and(eq(championUnlocks.userId, userId), eq(championUnlocks.championId, c))).get();
    if (!has) throw new HttpError(403, "champion_locked", "That champion hasn't joined you yet.");
    return { champion_id: c, reward: { xp: 0, coins: 0 }, first: false };
  }
  const reward = UNLOCK_REWARD[c];
  const paid = await recordRewardEvent(ctx, userId, "champion_unlock", reward.xp, reward.coins, c, `u${userId}:champion:unlock:${c}`);
  return { champion_id: c, reward: paid.applied ? reward : { xp: 0, coins: 0 }, first: true, progress: { total_xp: paid.total_xp, coins: paid.coins, level: paid.level } };
}
