// Your hero (design doc "Your Hero, Mastery and the Forge"): the seventh fighter. It levels 1-30 (one skill point a
// level), wears a built look, fights in one style at a time, and takes a loadout - one passive, one ultimate, up to
// three perks and up to two extra weaknesses - paid from loadout points (6 + level / 3).
//
// Where abilities come from:
//   * start: the Apprentice Blade, Second Wind, Rally;
//   * the skill tree: three branches of six tiers (free respec);
//   * champion mastery: a champion's passive at 50%, their style and ultimate at 100% - never sold or dropped;
//   * original styles and perks: the shop (coins), Bestiary tiers and weekly trials.
import { and, eq, isNotNull } from "drizzle-orm";
import type { RequestContext } from "../context";
import { championProgress, heroState, questScrolls } from "../db/schema";
import { HttpError } from "../http";
import { STARTER_LOOKS, cleanAppearance, sameAppearance, type Appearance } from "@/lib/game/appearance";
import { CHAMPIONS, type Champion } from "./content";
import {
  CHAMPION_KIT, EXTRA_WEAKNESSES, PASSIVES, PERKS, STYLES, ULTIMATES, WEAKNESSES, initHeroKit,
  type KitState, type NodeId, type PassiveId, type PerkId, type StyleId, type UltimateId, type WeaknessId,
} from "./kits";
import * as mastery from "./mastery";
import { finishedTiers, records } from "./tome";
import { getProgress, nowIso, recordRewardEvent } from "./store";

export const HERO_ID = "hero";
export const MAX_HERO_LEVEL = 30;
export const STUDY_SHARE = 0.25;
export const MAX_PERKS = 3, MAX_EXTRA_WEAKNESSES = 2;

/** XP to go from `level` to the next: 80 + 40 x level. */
export const heroLevelCost = (level: number) => 80 + 40 * level;
export function heroLevelFor(xp: number): { level: number; into: number; next: number | null } {
  let level = 1, left = Math.max(0, xp);
  while (level < MAX_HERO_LEVEL && left >= heroLevelCost(level)) { left -= heroLevelCost(level); level++; }
  return { level, into: left, next: level < MAX_HERO_LEVEL ? heroLevelCost(level) : null };
}
export const skillPoints = (level: number) => level - 1;
export const loadoutBudget = (level: number) => 6 + Math.floor(level / 3);

// ── the skill tree ──────────────────────────────────────────────────────────────────────────────────────────
export interface TreeNode { id: NodeId; branch: "o" | "d" | "m"; tier: number; name: string; text: string; ranks: number; unlocks?: string }
const node = (id: NodeId, name: string, text: string, ranks = 1, unlocks?: string): TreeNode =>
  ({ id, branch: id[0] as TreeNode["branch"], tier: Number(id[1]), name, text, ranks, unlocks });
export const TREE: TreeNode[] = [
  node("o1", "Sharpened", "Strike hits 5% harder per rank.", 2),
  node("o2", "Opening", "The first right answer of a fight hits x1.25."),
  node("o3", "Combo Fuel", "Unlocks the perk Combo Fuel.", 1, "perk:combo_fuel"),
  node("o4", "Heavy Hands", "Heavy hits +0.1 per rank.", 2),
  node("o5", "Finisher", "A right answer on a boss under 25% hits x1.2."),
  node("o6", "Overdrive", "Unlocks the ultimate Overdrive.", 1, "ultimate:overdrive"),
  node("d1", "Tough", "+1 heart per rank.", 2),
  node("d2", "Parry", "A right Guard adds +1 to your combo."),
  node("d3", "Thick Skin", "Unlocks the passive Thick Skin.", 1, "passive:thick_skin"),
  node("d4", "Steady", "A wrong Guard's blow is cut by 25%."),
  node("d5", "Last Stand", "On your last heart, a Guard blocks fully even when wrong, once a fight."),
  node("d6", "Aegis Dome", "Unlocks the ultimate Aegis Dome.", 1, "ultimate:aegis_dome"),
  node("m1", "Recall", "+5% hero XP from reviews per rank.", 2),
  node("m2", "Insightful", "The first Insight of a fight is free."),
  node("m3", "Focus Flow", "Unlocks the passive Focus Flow.", 1, "passive:focus_flow"),
  node("m4", "Deep Focus", "Your Focus cap is 1 higher."),
  node("m5", "Quick Study", "2 more seconds on every question."),
  node("m6", "Clarity", "Unlocks the ultimate Clarity.", 1, "ultimate:clarity"),
];
export type Tree = Partial<Record<NodeId, number>>;

/** A full allocation, or the reason it can't be. Tiers open top-down; tier 6 needs 5 points in its branch. */
export function treeProblem(tree: Tree, level: number): string | null {
  let total = 0;
  for (const [id, r] of Object.entries(tree)) {
    const n = TREE.find((x) => x.id === id);
    if (!n) return `There is no skill called ${id}.`;
    if (!Number.isInteger(r) || (r as number) < 0 || (r as number) > n.ranks) return `${n.name} takes 0 to ${n.ranks} points.`;
    total += r as number;
  }
  if (total > skillPoints(level)) return `That needs ${total} skill points; you have ${skillPoints(level)}.`;
  for (const n of TREE) {
    if (!(tree[n.id] ?? 0)) continue;
    const branch = TREE.filter((x) => x.branch === n.branch);
    if (n.tier > 1 && !(tree[branch[n.tier - 2].id] ?? 0)) return `${n.name} needs a point in ${branch[n.tier - 2].name} first.`;
    if (n.tier === 6 && branch.slice(0, 5).reduce((a, x) => a + (tree[x.id] ?? 0), 0) < 5) return `${n.name} needs 5 points in its branch first.`;
  }
  return null;
}
export function cleanTree(raw: unknown): Tree {
  const out: Tree = {};
  if (!raw || typeof raw !== "object") return out;
  for (const n of TREE) { const r = Number((raw as Record<string, unknown>)[n.id] ?? 0); if (Number.isInteger(r) && r > 0) out[n.id] = Math.min(n.ranks, r); }
  return out;
}

// ── costs and sources ───────────────────────────────────────────────────────────────────────────────────────
const CHAMPION_PASSIVES = new Set<PassiveId>(Object.values(CHAMPION_KIT).map((k) => k.passive));
const CHAMPION_ULTIMATES = new Set<UltimateId>(Object.values(CHAMPION_KIT).map((k) => k.ultimate));
export const passiveCost = (p: PassiveId) => (p === "second_wind" ? 2 : CHAMPION_PASSIVES.has(p) ? 4 : 3);
export const ultimateCost = (u: UltimateId) => (u === "rally" ? 2 : CHAMPION_ULTIMATES.has(u) ? 5 : 4);

/** Original styles and perks for sale (coins), and the player level each needs. */
export const FOR_SALE: Record<string, { coins: number; level: number }> = {
  "style:chain_whip": { coins: 1200, level: 12 },
  "perk:lucky_coin": { coins: 300, level: 5 },
  "perk:scholar": { coins: 300, level: 5 },
  "perk:quick_hands": { coins: 800, level: 8 },
};
/** Original styles earned in play: War Fan for finishing Bestiary tier II, Twin Kamas for 4 Trials of Iron. */
export const TRIALS_FOR_KAMAS = 4;

export interface Build { style: StyleId; passive: PassiveId; ultimate: UltimateId; perks: PerkId[]; weaknesses: WeaknessId[] }
export const STARTER_BUILD: Build = { style: "apprentice", passive: "second_wind", ultimate: "rally", perks: [], weaknesses: [] };

export function buildCost(b: Build) {
  return passiveCost(b.passive) + ultimateCost(b.ultimate) + b.perks.reduce((a, p) => a + PERKS[p].cost, 0) - b.weaknesses.reduce((a, w) => a + WEAKNESSES[w].points, 0);
}

function cleanBuild(raw: unknown): Build | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const list = <T extends string>(v: unknown, ok: (x: string) => x is T): T[] | null =>
    Array.isArray(v) && v.every((x) => typeof x === "string" && ok(x)) && new Set(v).size === v.length ? (v as T[]) : null;
  const isStyle = (x: string): x is StyleId => x in STYLES, isPassive = (x: string): x is PassiveId => x in PASSIVES;
  const isUlt = (x: string): x is UltimateId => x in ULTIMATES, isPerk = (x: string): x is PerkId => x in PERKS;
  const isExtra = (x: string): x is WeaknessId => (EXTRA_WEAKNESSES as string[]).includes(x);
  const perks = list(r.perks ?? [], isPerk), weaknesses = list(r.weaknesses ?? [], isExtra);
  if (typeof r.style !== "string" || !isStyle(r.style) || typeof r.passive !== "string" || !isPassive(r.passive)
    || typeof r.ultimate !== "string" || !isUlt(r.ultimate) || !perks || !weaknesses) return null;
  return { style: r.style, passive: r.passive, ultimate: r.ultimate, perks, weaknesses };
}

// ── state ───────────────────────────────────────────────────────────────────────────────────────────────────
interface Row { xp: number; look: Appearance | null; build: Build; tree: Tree; owned: string[] }
const parse = <T,>(s: string, d: T): T => { try { return (JSON.parse(s) ?? d) as T; } catch { return d; } };

async function row(ctx: RequestContext, userId: number): Promise<Row> {
  const r = await ctx.db.select().from(heroState).where(eq(heroState.userId, userId)).get();
  if (!r) return { xp: 0, look: null, build: { ...STARTER_BUILD }, tree: {}, owned: [] };
  return { xp: r.xp, look: r.lookJson ? cleanAppearance(parse(r.lookJson, null)) : null, build: cleanBuild(parse(r.buildJson, {})) ?? { ...STARTER_BUILD },
    tree: cleanTree(parse(r.treeJson, {})), owned: parse<string[]>(r.ownedJson, []).filter((x) => typeof x === "string") };
}

async function save(ctx: RequestContext, userId: number, patch: Partial<{ xp: number; look: Appearance | null; build: Build; tree: Tree; owned: string[] }>) {
  const t = nowIso();
  const set: Record<string, unknown> = { updatedAt: t };
  if (patch.xp !== undefined) set.xp = patch.xp;
  if (patch.look !== undefined) set.lookJson = patch.look ? JSON.stringify(patch.look) : "";
  if (patch.build) set.buildJson = JSON.stringify(patch.build);
  if (patch.tree) set.treeJson = JSON.stringify(patch.tree);
  if (patch.owned) set.ownedJson = JSON.stringify(patch.owned);
  await ctx.db.insert(heroState).values({ userId, createdAt: t, updatedAt: t, ...(set as object) }).onConflictDoUpdate({ target: heroState.userId, set });
}

/** Champion mastery for every champion, from their XP and challenge rows. */
async function masteries(ctx: RequestContext, userId: number) {
  const [xpRows, chRows] = await Promise.all([
    ctx.db.select().from(championProgress).where(eq(championProgress.userId, userId)).all(), mastery.challengeRows(ctx, userId),
  ]);
  return Object.fromEntries(CHAMPIONS.map((c) => [c, mastery.masteryOf(c, xpRows.find((r) => r.championId === c)?.xp ?? 0, chRows)])) as Record<Champion, mastery.MasteryView>;
}

/** Everything your hero may use right now, and how each locked thing is reached. */
async function owned(ctx: RequestContext, userId: number, r: Row) {
  const m = await masteries(ctx, userId);
  const tiers = finishedTiers(await records(ctx, userId));
  const trials = (await ctx.db.select().from(questScrolls)
    .where(and(eq(questScrolls.userId, userId), eq(questScrolls.scrollId, "trial_hard"), isNotNull(questScrolls.claimedAt))).all()).length;
  const tree = new Set(TREE.filter((n) => n.unlocks && (r.tree[n.id] ?? 0) > 0).map((n) => n.unlocks!));
  const styles = new Set<StyleId>(["apprentice"]), passives = new Set<PassiveId>(["second_wind"]), ultimates = new Set<UltimateId>(["rally"]), perks = new Set<PerkId>();
  for (const c of CHAMPIONS) {
    if (m[c].passive_learnable) passives.add(CHAMPION_KIT[c].passive);
    if (m[c].complete) { styles.add(CHAMPION_KIT[c].style); ultimates.add(CHAMPION_KIT[c].ultimate); }
  }
  for (const x of [...r.owned, ...tree]) {
    const [kind, id] = x.split(":");
    if (kind === "style" && id in STYLES) styles.add(id as StyleId);
    if (kind === "perk" && id in PERKS) perks.add(id as PerkId);
    if (kind === "passive" && id in PASSIVES) passives.add(id as PassiveId);
    if (kind === "ultimate" && id in ULTIMATES) ultimates.add(id as UltimateId);
  }
  if (tiers.includes(2)) styles.add("war_fan");
  if (trials >= TRIALS_FOR_KAMAS) styles.add("twin_kamas");
  if (tiers.includes(3)) perks.add("vampiric");
  return { styles, passives, ultimates, perks, masteries: m, tiers, trials };
}

/** Is this look a copy of a champion who isn't mastered yet? (The champion tiles stay locked until 100%.) */
function lockedCopy(look: Appearance, m: Record<Champion, mastery.MasteryView>): Champion | null {
  for (const c of CHAMPIONS) if (STARTER_LOOKS[c] && sameAppearance(look, STARTER_LOOKS[c]) && !m[c].complete) return c;
  return null;
}

/** Your hero, as the client draws and edits it. */
export async function heroView(ctx: RequestContext, userId: number) {
  const r = await row(ctx, userId);
  const lv = heroLevelFor(r.xp);
  const o = await owned(ctx, userId, r);
  const playerLevel = (await getProgress(ctx, userId)).currentLevel;
  const spent = Object.values(r.tree).reduce((a, x) => a + (x ?? 0), 0);
  const source = (c: Champion | undefined, extra: string) => (c ? `${c[0].toUpperCase()}${c.slice(1)} at 100% mastery` : extra);
  const champOf = (pick: (k: (typeof CHAMPION_KIT)[Champion]) => string, id: string) => CHAMPIONS.find((c) => pick(CHAMPION_KIT[c]) === id);
  return {
    level: lv.level, xp: r.xp, level_xp: lv.into, next_level_xp: lv.next,
    skill_points: skillPoints(lv.level), skill_spent: spent, loadout_budget: loadoutBudget(lv.level), loadout_cost: buildCost(r.build),
    look: r.look, build: r.build, tree: r.tree,
    catalog: {
      styles: (Object.keys(STYLES) as StyleId[]).map((id) => {
        const c = STYLES[id].champion, sale = FOR_SALE[`style:${id}`];
        const how = id === "apprentice" ? "Your starting style" : c ? source(c, "") : sale ? `Shop: ${sale.coins} coins at player level ${sale.level}`
          : id === "war_fan" ? "Finish Bestiary tier II" : `Win the Trial of Iron ${TRIALS_FOR_KAMAS} weeks (${Math.min(o.trials, TRIALS_FOR_KAMAS)}/${TRIALS_FOR_KAMAS})`;
        return { id, name: STYLES[id].name, bonus: STYLES[id].bonus, weakness: WEAKNESSES[STYLES[id].weakness], anim: STYLES[id].anim, owned: o.styles.has(id), how,
          progress: c ? o.masteries[c].pct : null, for_sale: sale && !o.styles.has(id) ? { ...sale, can_buy: playerLevel >= sale.level } : null };
      }),
      passives: (Object.keys(PASSIVES) as PassiveId[]).map((id) => {
        const c = champOf((k) => k.passive, id), node = TREE.find((n) => n.unlocks === `passive:${id}`);
        return { id, ...PASSIVES[id], cost: passiveCost(id), owned: o.passives.has(id), progress: c ? o.masteries[c].pct : null,
          how: id === "second_wind" ? "Your starting passive" : c ? `${c[0].toUpperCase()}${c.slice(1)} at 50% mastery` : `Skill tree: ${node?.name}` };
      }),
      ultimates: (Object.keys(ULTIMATES) as UltimateId[]).map((id) => {
        const c = champOf((k) => k.ultimate, id), node = TREE.find((n) => n.unlocks === `ultimate:${id}`);
        return { id, ...ULTIMATES[id], cost: ultimateCost(id), owned: o.ultimates.has(id), progress: c ? o.masteries[c].pct : null,
          how: id === "rally" ? "Your starting ultimate" : c ? source(c, "") : `Skill tree: ${node?.name}` };
      }),
      perks: (Object.keys(PERKS) as PerkId[]).map((id) => {
        const sale = FOR_SALE[`perk:${id}`];
        return { id, name: PERKS[id].name, text: PERKS[id].text, cost: PERKS[id].cost, owned: o.perks.has(id),
          how: sale ? `Shop: ${sale.coins} coins at player level ${sale.level}` : id === "combo_fuel" ? "Skill tree: Combo Fuel" : "Finish Bestiary tier III",
          for_sale: sale && !o.perks.has(id) ? { ...sale, can_buy: playerLevel >= sale.level } : null };
      }),
      weaknesses: EXTRA_WEAKNESSES.map((id) => ({ id, ...WEAKNESSES[id] })),
      tree: TREE,
    },
    looks_unlocked: CHAMPIONS.filter((c) => o.masteries[c].complete),
  };
}

/** Save the hero's look. A champion's look can only be copied once that champion is mastered. */
export async function saveLook(ctx: RequestContext, userId: number, raw: unknown) {
  const look = raw === null ? null : cleanAppearance(raw);
  if (raw !== null && !look) throw new HttpError(422, "invalid_look", "That look has a choice we can't draw. Pick from the options shown.");
  if (look) {
    const c = lockedCopy(look, await masteries(ctx, userId));
    if (c) throw new HttpError(403, "look_locked", `${c[0].toUpperCase()}${c.slice(1)}'s look unlocks at 100% mastery. Change anything to make it your own.`);
  }
  await save(ctx, userId, { look });
  return heroView(ctx, userId);
}

/** Save the hero's loadout: everything owned, within the loadout points, at most 3 perks and 2 extra weaknesses. */
export async function saveBuild(ctx: RequestContext, userId: number, raw: unknown) {
  const b = cleanBuild(raw);
  if (!b) throw new HttpError(422, "invalid_build", "That loadout has a choice that doesn't exist.");
  const r = await row(ctx, userId);
  const o = await owned(ctx, userId, r);
  const lv = heroLevelFor(r.xp).level;
  const missing = [!o.styles.has(b.style) && STYLES[b.style].name, !o.passives.has(b.passive) && PASSIVES[b.passive].name,
    !o.ultimates.has(b.ultimate) && ULTIMATES[b.ultimate].name, ...b.perks.filter((p) => !o.perks.has(p)).map((p) => PERKS[p].name)].filter(Boolean);
  if (missing.length) throw new HttpError(403, "not_owned", `You haven't unlocked ${missing.join(", ")} yet.`);
  if (b.perks.length > MAX_PERKS) throw new HttpError(422, "too_many_perks", `Up to ${MAX_PERKS} perks at a time.`);
  if (b.weaknesses.length > MAX_EXTRA_WEAKNESSES) throw new HttpError(422, "too_many_weaknesses", `Up to ${MAX_EXTRA_WEAKNESSES} extra weaknesses at a time.`);
  const cost = buildCost(b), budget = loadoutBudget(lv);
  if (cost > budget) throw new HttpError(422, "over_budget", `That loadout costs ${cost} points; you have ${budget}.`, null, { cost, budget });
  await save(ctx, userId, { build: b });
  return heroView(ctx, userId);
}

/** Spend skill points (the whole allocation; respec is free). A loadout using something the new tree drops goes back to the start kit for that slot. */
export async function saveTree(ctx: RequestContext, userId: number, raw: unknown) {
  if (!raw || typeof raw !== "object") throw new HttpError(422, "invalid_tree", "Send the skill tree as { node: points }.");
  const tree = raw as Tree;
  const r = await row(ctx, userId);
  const problem = treeProblem(tree, heroLevelFor(r.xp).level);
  if (problem) throw new HttpError(422, "invalid_tree", problem);
  const clean = cleanTree(tree);
  const next = { ...r, tree: clean };
  const o = await owned(ctx, userId, next);
  const b = { ...r.build };
  if (!o.passives.has(b.passive)) b.passive = "second_wind";
  if (!o.ultimates.has(b.ultimate)) b.ultimate = "rally";
  b.perks = b.perks.filter((p) => o.perks.has(p));
  await save(ctx, userId, { tree: clean, build: b });
  return heroView(ctx, userId);
}

/** Buy an original style or a perk for coins (once). */
export async function buy(ctx: RequestContext, userId: number, item: unknown) {
  const sale = typeof item === "string" ? FOR_SALE[item] : undefined;
  if (!sale) throw new HttpError(422, "not_for_sale", "That isn't sold here.");
  const r = await row(ctx, userId);
  if (r.owned.includes(item as string)) throw new HttpError(409, "already_owned", "You already have that.");
  if ((await getProgress(ctx, userId)).currentLevel < sale.level) throw new HttpError(403, "level_locked", `That unlocks at player level ${sale.level}.`);
  const paid = await recordRewardEvent(ctx, userId, "hero_purchase", 0, -sale.coins, item as string, `u${userId}:hero_buy:${item}`);
  if (!paid.applied) throw new HttpError(402, "not_enough_coins", `That costs ${sale.coins} coins.`);
  await save(ctx, userId, { owned: [...r.owned, item as string] });
  return heroView(ctx, userId);
}

/** Hero XP: a fight fought as your hero (full), or a share of everything else (STUDY_SHARE). Returns the new level. */
export async function addXp(ctx: RequestContext, userId: number, xp: number) {
  if (xp <= 0) return null;
  const r = await row(ctx, userId);
  const before = heroLevelFor(r.xp).level;
  const total = r.xp + Math.round(xp);
  await save(ctx, userId, { xp: total });
  const after = heroLevelFor(total);
  return { xp_gained: Math.round(xp), xp: total, level: after.level, leveled_up: after.level > before, next_level_xp: after.next, level_xp: after.into };
}

/** The kit your hero brings into a fight (its saved build; anything no longer owned falls back to the start kit). */
export async function heroKit(ctx: RequestContext, userId: number, name: string): Promise<KitState> {
  const r = await row(ctx, userId);
  const o = await owned(ctx, userId, r);
  const b = { ...r.build };
  if (!o.styles.has(b.style)) b.style = "apprentice";
  if (!o.passives.has(b.passive)) b.passive = "second_wind";
  if (!o.ultimates.has(b.ultimate)) b.ultimate = "rally";
  b.perks = b.perks.filter((p) => o.perks.has(p));
  return initHeroKit({ name, ...b, tree: r.tree });
}

/** XP-side perks and nodes: Scholar (+10% hero XP), Recall (+5% from reviews per rank). */
export async function xpBoost(ctx: RequestContext, userId: number, fromReview: boolean) {
  const r = await row(ctx, userId);
  return 1 + (r.build.perks.includes("scholar") ? 0.1 : 0) + (fromReview ? 0.05 * (r.tree.m1 ?? 0) : 0);
}

/** The styles your hero owns (their base weapons can be forged). */
export async function ownedStyles(ctx: RequestContext, userId: number): Promise<string[]> {
  return [...(await owned(ctx, userId, await row(ctx, userId))).styles];
}
