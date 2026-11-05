// Who may wear or use an item (port of backend/services/progression/ownership.py): a paid item, or its bonus, can
// only be had by owning it. A mastery skin is earned by levelling one champion and only that champion wears it.
import { ITEMS } from "./content";

export const STARTER_ITEMS = new Set(["armor_shirt_basic"]);
export const SLOT_BY_TYPE: Record<string, string> = { armor: "armor", headgear: "headgear", weapon: "weapon", pet: "pet", title: "title" };
export const EQUIP_SLOTS = new Set(Object.values(SLOT_BY_TYPE));

export const masteryChampion = (id: string) => ITEMS.get(id)?.mastery?.champion ?? null;

/** Free to everyone (a mastery skin costs nothing but is earned, not free). */
export function isFree(id: string): boolean {
  const it = ITEMS.get(id);
  return !!it && (it.price ?? 1) === 0 && !it.mastery;
}

export function canUseItem(id: string, owned: Iterable<string>): boolean {
  if (!ITEMS.has(id)) return false;
  if (STARTER_ITEMS.has(id) || isFree(id)) return true;
  return new Set(owned).has(id);
}

export function canEquipInSlot(id: string, slot: string, owned: Iterable<string>, champion?: string | null): boolean {
  const it = ITEMS.get(id);
  if (!it || SLOT_BY_TYPE[it.type] !== slot) return false;
  if (it.mastery && it.mastery.champion !== (champion || "kaien")) return false;
  return canUseItem(id, owned);
}
