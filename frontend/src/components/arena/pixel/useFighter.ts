"use client";

import { useMemo } from "react";
import { useArenaHero } from "@/hooks/useArenaHero";
import { previewEquipped, useHeroStore } from "@/hooks/useHero";
import { geared, heroById, type HeroDef } from "@/lib/pixel/heroes";
import { rarityOf } from "@/lib/rarity";

/** The player's chosen champion, dressed in their gear: a rare+ weapon glows in its rarity's colour, rare+ armour
 *  tints the outfit. */
export function useFighter(): HeroDef {
  const heroId = useArenaHero((s) => s.heroId);
  const shop = useHeroStore((s) => s.shop);
  return useMemo(() => {
    const equipped = previewEquipped(shop, null);
    const find = (slot: string) => shop?.items.find((i) => i.id === (equipped[slot] || (slot === "armor" ? equipped.outfit_id : "")));
    const w = find("weapon"), a = find("armor");
    return geared(heroById(heroId), { weaponRarity: w ? rarityOf(w) : null, armorRarity: a ? rarityOf(a) : null });
  }, [heroId, shop]);
}
