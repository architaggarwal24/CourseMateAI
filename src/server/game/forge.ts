// The forge (design doc "Your Hero, Mastery and the Forge"): every weapon, outfit, head piece and pet you own earns
// XP when it is worn in a fight. A full bar plus coins plus materials (dropped by Bestiary creatures) raises it one
// tier, I to V: a small capped bonus (+5% a tier, +20% at most) and a new look. A pet grows with its tiers (baby,
// young, adult); an adult pet can be saddled and ridden as a mount, which brings a small bonus of its own.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { forgeMaterials, itemProgress } from "../db/schema";
import { HttpError } from "../http";
import { CREATURES } from "./bestiary";
import { ITEMS } from "./content";
import { getAvatar, modifyAvatar, nowIso, recordRewardEvent } from "./store";

export const MAX_TIER = 5;
export const TIER_BONUS = 0.05;
/** Per upgrade (from tier I, II, III, IV): XP to be ready, coins, common and rare materials. */
export const UPGRADES = [
  { xp: 100, coins: 150, common: 3, rare: 0 },
  { xp: 250, coins: 400, common: 6, rare: 0 },
  { xp: 500, coins: 900, common: 8, rare: 1 },
  { xp: 900, coins: 1800, common: 12, rare: 3 },
];
export const SADDLE = { tier: 4, coins: 600, rare: 2 };
/** XP each worn item earns in a fight. */
export const itemXp = (correct: number, won: boolean) => 10 + 2 * correct + (won ? 15 : 0);
export const bonusFor = (tier: number) => TIER_BONUS * (Math.max(1, Math.min(MAX_TIER, tier)) - 1);

/** Materials by the creatures' land: one common, one rare. */
export const MATERIALS: Record<string, { common: string; rare: string }> = {
  Greek: { common: "bronze_ore", rare: "labyrinth_heart" },
  Japanese: { common: "oni_horn", rare: "foxfire_pearl" },
  Indian: { common: "naga_scale", rare: "temple_gold" },
  Norse: { common: "frost_iron", rare: "serpent_fang" },
  Egyptian: { common: "desert_glass", rare: "feather_of_truth" },
  Persian: { common: "simurgh_feather", rare: "sun_plume" },
};
export const MATERIAL_NAMES: Record<string, string> = {
  bronze_ore: "Bronze ore", labyrinth_heart: "Labyrinth heart", oni_horn: "Oni horn", foxfire_pearl: "Fox-fire pearl",
  naga_scale: "Naga scale", temple_gold: "Temple gold", frost_iron: "Frost iron", serpent_fang: "World-serpent fang",
  desert_glass: "Desert glass", feather_of_truth: "Feather of truth", simurgh_feather: "Simurgh feather", sun_plume: "Sun plume",
};
const COMMON = new Set(Object.values(MATERIALS).map((m) => m.common));
const RARE = new Set(Object.values(MATERIALS).map((m) => m.rare));
export const isRare = (id: string) => RARE.has(id);

/** Pet body plans decide what a mount gives (pets.ts SPECS: beasts, birds, dragons). */
export const MOUNT_KIND: Record<string, "beast" | "bird" | "dragon"> = {
  pet_cat_orange: "beast", pet_dog_brown: "beast", pet_panda: "beast", pet_fox: "beast", pet_unicorn: "beast", pet_lion_golden: "beast",
  pet_owl: "bird", pet_phoenix: "bird", pet_dragon_baby: "dragon", pet_dragon_ancient: "dragon",
};
export const MOUNT_BONUS = { beast: "+5% chance to slip past a blow", bird: "+3 seconds on the first question of a fight", dragon: "Right Heavies hit 5% harder" };
export const petStage = (tier: number) => (tier >= 4 ? "adult" : tier >= 2 ? "young" : "baby");

/** The gear slots that earn XP, and your hero's base weapon (its style) when no weapon skin is worn. */
const XP_SLOTS = ["weapon", "armor", "headgear", "pet"] as const;
export function wornItems(equipped: Record<string, string | undefined>, heroStyle: string | null): string[] {
  const ids = XP_SLOTS.map((s) => equipped[s]).filter((x): x is string => !!x);
  if (heroStyle && !equipped.weapon) ids.push(`style:${heroStyle}`);
  return ids;
}

export async function tiersOf(ctx: RequestContext, userId: number, ids: string[]): Promise<Record<string, number>> {
  if (!ids.length) return {};
  const rows = await ctx.db.select().from(itemProgress).where(and(eq(itemProgress.userId, userId), inArray(itemProgress.itemId, ids))).all();
  return Object.fromEntries(rows.map((r) => [r.itemId, r.tier]));
}

/** A fight ended: every worn item earns XP (the bar fills up to the next tier and waits there). */
export async function fightXp(ctx: RequestContext, userId: number, ids: string[], correct: number, won: boolean) {
  const xp = itemXp(correct, won), t = nowIso();
  for (const id of ids) {
    await ctx.db.insert(itemProgress).values({ userId, itemId: id, xp, updatedAt: t })
      .onConflictDoUpdate({ target: [itemProgress.userId, itemProgress.itemId], set: { xp: sql`${itemProgress.xp} + ${xp}`, updatedAt: t } });
  }
  return { item_xp: xp, items: ids };
}

/** A Bestiary win drops materials from the creature's land (more on hard and nightmare; rare ones on nightmare). */
export async function dropMaterials(ctx: RequestContext, userId: number, species: string, difficulty: string, won: boolean, tiersFinished: number, rng = Math.random) {
  if (!won) return [];
  const land = MATERIALS[CREATURES[species]?.origin ?? ""] ?? MATERIALS.Greek;
  const out: Record<string, number> = {};
  if (rng() < 0.6) out[land.common] = difficulty === "nightmare" ? 3 : difficulty === "hard" ? 2 : 1;
  if (difficulty === "nightmare" && rng() < 0.25) out[land.rare] = (out[land.rare] ?? 0) + 1;
  if (tiersFinished > 0) out[land.rare] = (out[land.rare] ?? 0) + 3 * tiersFinished;
  for (const [id, n] of Object.entries(out)) {
    await ctx.db.insert(forgeMaterials).values({ userId, materialId: id, quantity: n })
      .onConflictDoUpdate({ target: [forgeMaterials.userId, forgeMaterials.materialId], set: { quantity: sql`${forgeMaterials.quantity} + ${n}` } });
  }
  return Object.entries(out).map(([id, n]) => ({ id, name: MATERIAL_NAMES[id] ?? id, count: n, rare: RARE.has(id) }));
}

/** Take `common` common and `rare` rare materials, the most plentiful first. Null (and nothing taken) if short; `dry` only checks. */
async function spend(ctx: RequestContext, userId: number, common: number, rare: number, dry = false) {
  const rows = await ctx.db.select().from(forgeMaterials).where(eq(forgeMaterials.userId, userId)).all();
  const take: Record<string, number> = {};
  for (const [want, pool] of [[common, COMMON], [rare, RARE]] as const) {
    let left = want;
    for (const r of rows.filter((x) => pool.has(x.materialId)).sort((a, b) => b.quantity - a.quantity)) {
      if (!left) break;
      const n = Math.min(left, r.quantity);
      if (n > 0) { take[r.materialId] = n; left -= n; }
    }
    if (left > 0) return null;
  }
  if (dry) return take;
  for (const [id, n] of Object.entries(take)) {
    await ctx.db.update(forgeMaterials).set({ quantity: sql`${forgeMaterials.quantity} - ${n}` })
      .where(and(eq(forgeMaterials.userId, userId), eq(forgeMaterials.materialId, id)));
  }
  return take;
}

/** What can be forged: the gear you own (and your hero's styles), its tier and bar, and your materials. */
export async function forgeView(ctx: RequestContext, userId: number, heroStyles: string[] = []) {
  const a = await getAvatar(ctx, userId);
  const owned = a.owned.filter((id) => ["weapon", "armor", "headgear", "pet"].includes(ITEMS.get(id)?.category ?? "") || /^mastery_/.test(id));
  const ids = [...owned, ...heroStyles.map((s) => `style:${s}`)];
  const rows = ids.length ? await ctx.db.select().from(itemProgress).where(and(eq(itemProgress.userId, userId), inArray(itemProgress.itemId, ids))).all() : [];
  const mats = await ctx.db.select().from(forgeMaterials).where(eq(forgeMaterials.userId, userId)).all();
  const items = ids.map((id) => {
    const r = rows.find((x) => x.itemId === id);
    const tier = r?.tier ?? 1, xp = r?.xp ?? 0, next = tier < MAX_TIER ? UPGRADES[tier - 1] : null;
    const cat = id.startsWith("style:") ? "weapon" : ITEMS.get(id)?.category ?? (id.includes("_weapon") ? "weapon" : id.includes("_head") ? "headgear" : id.includes("_outfit") ? "armor" : "pet");
    return {
      id, category: cat, tier, xp, bonus: bonusFor(tier), next, ready: !!next && xp >= next.xp,
      worn: Object.values(a.equipped).includes(id), saddled: !!r?.saddled,
      ...(cat === "pet" ? { stage: petStage(tier), mount_kind: MOUNT_KIND[id] ?? "beast", can_saddle: tier >= SADDLE.tier && !r?.saddled } : {}),
    };
  });
  return {
    items, mount: a.equipped.mount ?? null,
    materials: mats.filter((m) => m.quantity > 0).map((m) => ({ id: m.materialId, name: MATERIAL_NAMES[m.materialId] ?? m.materialId, count: m.quantity, rare: RARE.has(m.materialId) })),
    rules: { upgrades: UPGRADES, saddle: SADDLE, mount_bonus: MOUNT_BONUS },
  };
}

/** Raise an item one tier: its bar full, then coins and materials. */
export async function upgrade(ctx: RequestContext, userId: number, itemId: unknown, heroStyles: string[] = []) {
  const view = await forgeView(ctx, userId, heroStyles);
  const it = view.items.find((x) => x.id === itemId);
  if (!it) throw new HttpError(404, "not_owned", "You don't own that.");
  if (!it.next) throw new HttpError(409, "max_tier", "That is already at tier V.");
  if (it.xp < it.next.xp) throw new HttpError(409, "not_ready", `It needs ${it.next.xp - it.xp} more XP: wear it in fights.`);
  const short = () => new HttpError(409, "not_enough_materials", `That needs ${it.next!.common} common${it.next!.rare ? ` and ${it.next!.rare} rare` : ""} materials from Bestiary wins.`);
  if (!(await spend(ctx, userId, it.next.common, it.next.rare, true))) throw short();
  // one payment per tier (a double click can't pay twice)
  const paid = await recordRewardEvent(ctx, userId, "forge_upgrade", 0, -it.next.coins, `${it.id}:${it.tier + 1}`, `u${userId}:forge:${it.id}:${it.tier + 1}`);
  if (!paid.applied) throw new HttpError(402, "not_enough_coins", `That costs ${it.next.coins} coins.`);
  if (!(await spend(ctx, userId, it.next.common, it.next.rare))) throw short();
  const t = nowIso();
  await ctx.db.insert(itemProgress).values({ userId, itemId: it.id, xp: it.xp - it.next.xp, tier: it.tier + 1, updatedAt: t })
    .onConflictDoUpdate({ target: [itemProgress.userId, itemProgress.itemId], set: { xp: it.xp - it.next.xp, tier: it.tier + 1, updatedAt: t } });
  return forgeView(ctx, userId, heroStyles);
}

/** Saddle an adult pet (tier IV+): it can then be your mount. */
export async function saddle(ctx: RequestContext, userId: number, petId: unknown, heroStyles: string[] = []) {
  const view = await forgeView(ctx, userId, heroStyles);
  const it = view.items.find((x) => x.id === petId && x.category === "pet");
  if (!it) throw new HttpError(404, "not_owned", "You don't own that pet.");
  if (it.saddled) throw new HttpError(409, "already_saddled", "That pet already has a saddle.");
  if (it.tier < SADDLE.tier) throw new HttpError(409, "not_grown", "Only an adult pet (tier IV) can carry you.");
  if (!(await spend(ctx, userId, 0, SADDLE.rare, true))) throw new HttpError(409, "not_enough_materials", `A saddle needs ${SADDLE.rare} rare materials.`);
  const paid = await recordRewardEvent(ctx, userId, "saddle", 0, -SADDLE.coins, it.id, `u${userId}:saddle:${it.id}`);
  if (!paid.applied) throw new HttpError(402, "not_enough_coins", `A saddle costs ${SADDLE.coins} coins.`);
  await spend(ctx, userId, 0, SADDLE.rare);
  await ctx.db.update(itemProgress).set({ saddled: true, updatedAt: nowIso() }).where(and(eq(itemProgress.userId, userId), eq(itemProgress.itemId, it.id)));
  return forgeView(ctx, userId, heroStyles);
}

/** Ride a saddled pet (or none). A pet can't be your pet and your mount at once: riding it takes it out of the pet slot. */
export async function setMount(ctx: RequestContext, userId: number, petId: unknown, heroStyles: string[] = []) {
  if (petId !== null) {
    const it = (await forgeView(ctx, userId, heroStyles)).items.find((x) => x.id === petId);
    if (!it?.saddled) throw new HttpError(409, "not_saddled", "Only a saddled pet can be ridden.");
  }
  await modifyAvatar(ctx, userId, (eq2) => {
    if (petId === null) delete eq2.mount;
    else { eq2.mount = petId as string; if (eq2.pet === petId) delete eq2.pet; }
  });
  return forgeView(ctx, userId, heroStyles);
}
