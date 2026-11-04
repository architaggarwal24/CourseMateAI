"use client";

import { useMemo } from "react";
import { useChampion } from "@/hooks/useChampion";
import { previewEquipped, useHeroStore, type ShopState } from "@/hooks/useHero";
import { heroById, type HeroDef } from "@/lib/pixel/heroes";
import { petById } from "@/lib/pixel/pets";
import { dressed, type Loadout } from "@/lib/pixel/skins";
import { rarityOf } from "@/lib/rarity";

export interface ChampionLook {
  /** The champion wearing its skins (pass to PixelSprite). */
  hero: HeroDef;
  /** The pet that idles beside it, if any. */
  petId: string | null;
  loadout: Loadout;
}

/** The skins worn (plus the item being tried on, when `previewId` is given). */
export function loadoutFrom(shop: ShopState | null, previewId: string | null = null): Loadout {
  const eq = previewEquipped(shop, previewId);
  return { armor: eq.armor || null, headgear: eq.headgear || null, weapon: eq.weapon || null, pet: eq.pet || null };
}

/** A champion dressed in a loadout: the weapon glows in its rarity (rarity follows the item's price). */
export function lookFor(championId: string, shop: ShopState | null, previewId: string | null = null): ChampionLook {
  const loadout = loadoutFrom(shop, previewId);
  const weapon = loadout.weapon ? shop?.items.find((i) => i.id === loadout.weapon) : undefined;
  const hero = dressed(heroById(championId), loadout, { weapon: weapon ? rarityOf(weapon) : null });
  return { hero, loadout, petId: petById(loadout.pet) ? loadout.pet! : null };
}

/**
 * The player's champion as every screen draws it. `preview: true` includes the item being tried on in the shop
 * or the Champion tab; `championId` shows another champion in the same skins (the roster).
 */
export function useChampionLook(opts: { preview?: boolean; championId?: string } = {}): ChampionLook {
  const mine = useChampion((s) => s.championId);
  const shop = useHeroStore((s) => s.shop);
  const previewId = useHeroStore((s) => s.previewId);
  const id = opts.championId ?? mine;
  const pid = opts.preview ? previewId : null;
  return useMemo(() => lookFor(id, shop, pid), [id, shop, pid]);
}
