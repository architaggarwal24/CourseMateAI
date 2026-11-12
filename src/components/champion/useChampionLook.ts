"use client";

import { useMemo } from "react";
import { useChampion } from "@/hooks/useChampion";
import { previewEquipped, useHeroStore, type ShopState } from "@/hooks/useHero";
import { heroById, type HeroDef } from "@/lib/pixel/heroes";
import { petById } from "@/lib/pixel/pets";
import { dressed, forged, type Loadout } from "@/lib/pixel/skins";
import { tierMap, useForge } from "@/hooks/useForge";
import { HERO_FIGHTER_ID, heroFighter } from "@/lib/pixel/appearance";
import type { Appearance } from "@/lib/game/appearance";
import { useMyHero } from "@/hooks/useMyHero";

/** What draws your hero: its style and look (the look editor passes a draft look). */
export interface HeroLook { style?: string | null; look?: Appearance | null }
import { rarityOf } from "@/lib/game/rarity";

export interface ChampionLook {
  /** The champion wearing its skins (pass to PixelSprite). */
  hero: HeroDef;
  /** The pet that idles beside it, if any, and how grown it is (forge tiers). */
  petId: string | null;
  petStage: "baby" | "young" | "adult";
  /** The saddled pet ridden into fights, if any. */
  mount: string | null;
  loadout: Loadout;
}

/** The skins worn (plus the item being tried on, when `previewId` is given). */
export function loadoutFrom(shop: ShopState | null, previewId: string | null = null): Loadout {
  const eq = previewEquipped(shop, previewId);
  return { armor: eq.armor || null, headgear: eq.headgear || null, weapon: eq.weapon || null, pet: eq.pet || null };
}

/** A champion dressed in a loadout: the weapon glows in its rarity (rarity follows the item's price). */
export function lookFor(championId: string, shop: ShopState | null, previewId: string | null = null, mine?: HeroLook | null, tiers?: Record<string, number>, mount: string | null = null): ChampionLook {
  const loadout = loadoutFrom(shop, previewId);
  const weapon = loadout.weapon ? shop?.items.find((i) => i.id === loadout.weapon) : undefined;
  // your hero is drawn from its own look and style; a champion is fixed (its skins still apply)
  const base = championId === HERO_FIGHTER_ID ? heroFighter({ style: mine?.style, look: mine?.look }) : heroById(championId);
  const isHero = championId === HERO_FIGHTER_ID;
  const hero = forged(dressed(base, loadout, { weapon: weapon ? rarityOf(weapon) : null }), loadout, tiers, isHero ? mine?.style ?? "apprentice" : null);
  const petTier = loadout.pet ? tiers?.[loadout.pet] ?? 1 : 1;
  const petStage = petTier >= 4 ? "adult" : petTier >= 2 ? "young" : "baby";
  return { hero, loadout, petId: petById(loadout.pet) ? loadout.pet! : null, petStage, mount: petById(mount) ? mount : null };
}

/**
 * The player's champion as every screen draws it. `preview: true` includes the item being tried on in the shop
 * or the Champion tab; `championId` shows another champion in the same skins (the roster).
 */
export function useChampionLook(opts: { preview?: boolean; championId?: string; appearance?: Appearance | null; style?: string } = {}): ChampionLook {
  const mine = useChampion((s) => s.championId);
  const shop = useHeroStore((s) => s.shop);
  const previewId = useHeroStore((s) => s.previewId);
  const id = opts.championId ?? mine;
  const heroLook = useMyHeroLook();
  // `appearance` / `style` (the editors' drafts) win over the saved ones
  const look = opts.appearance !== undefined ? opts.appearance : heroLook.look;
  const style = opts.style ?? heroLook.style;
  const pid = opts.preview ? previewId : null;
  const forge = useForge((s) => s.view);
  return useMemo(() => lookFor(id, shop, pid, { look, style }, forge ? tierMap(forge) : undefined, forge?.mount ?? null), [id, shop, pid, look, style, forge]);
}

/** Your hero's saved look and style (loads them once, on first use). */
export function useMyHeroLook(): HeroLook {
  const look = useMyHero((s) => s.view?.look ?? null);
  const style = useMyHero((s) => s.view?.build.style ?? null);
  return { look, style };
}
