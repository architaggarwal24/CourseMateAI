"use client";

import { useChampionLook } from "@/components/champion/useChampionLook";
import type { HeroDef } from "@/lib/pixel/heroes";

/** The player's champion, in its skins: a rare+ weapon finish glows in its rarity's colour. */
export function useFighter(): HeroDef {
  return useChampionLook().hero;
}

/** The pet that fights beside the champion (null when none is worn). */
export function useFighterPet(): string | null {
  return useChampionLook().petId;
}
