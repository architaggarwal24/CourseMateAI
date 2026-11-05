// Champion kits (port of backend/core_brains/kits.py): each champion's passive and ultimate, and champion
// progression (XP, levels, mastery skins). The battle rules that use the kits are in arena code (Stage 4.5b).
import type { Champion } from "./content";

export const CUT_MULT = 2.5;
export const ASHA_JAB_MULT = 0.8;
export const WALL_TURNS = 2;
export const BRAK_COMBO_CAP = 8;
export const RUSH_PER_COMBO = 0.25;
export const LIBRARY_MULT = 2.0;
export const VANISH_BLOWS = 2;
export const VANISH_MULT = 1.5;
export const LAST_CHAPTER_HEARTS = 3;

export interface Kit { champion: Champion; passive_name: string; passive_text: string; ultimate_name: string; ultimate_text: string }

export const KITS: Record<Champion, Kit> = {
  kaien: { champion: "kaien", passive_name: "Riposte", passive_text: "A right Guard against a blow hits back for half a Strike.",
           ultimate_name: "Ninth Page Cut", ultimate_text: `Your next right answer hits x${CUT_MULT} and cuts through shields.` },
  asha: { champion: "asha", passive_name: "Reach", passive_text: `Your Jab hits x${ASHA_JAB_MULT} instead of x0.6.`,
          ultimate_name: "Dawn Wall", ultimate_text: `For ${WALL_TURNS} turns the boss's blows are halved and every right answer gives +1 Focus.` },
  brak: { champion: "brak", passive_name: "Iron Combo", passive_text: `Your combo bonus is doubled and grows up to ${BRAK_COMBO_CAP} (not 5).`,
          ultimate_name: "Iron Rush", ultimate_text: `Your next right answer hits x(1 + ${RUSH_PER_COMBO} x combo).` },
  mira: { champion: "mira", passive_name: "Quiet Study", passive_text: "A spell you cast gives its Focus back if you answer right.",
          ultimate_name: "Arcane Library", ultimate_text: `Insight and Timewarp, free, and your next right answer hits x${LIBRARY_MULT}.` },
  vex: { champion: "vex", passive_name: "Shadowstep", passive_text: "Now and then you slip past a blow entirely (25% easy, 20% medium and hard, 15% nightmare).",
         ultimate_name: "Vanish", ultimate_text: `The boss's next ${VANISH_BLOWS} blows miss, and your next right answer hits x${VANISH_MULT}.` },
  thorne: { champion: "thorne", passive_name: "Bulwark", passive_text: "A right answer cuts a blow to a third instead of half.",
            ultimate_name: "Last Chapter", ultimate_text: `+${LAST_CHAPTER_HEARTS} hearts now, and the next turn's blow is fully blocked.` },
};

export const LEVEL_XP = [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700];
export const MAX_LEVEL = LEVEL_XP.length;
const MASTERY: [string, string, number][] = [["outfit", "armor", 3], ["head", "headgear", 6], ["weapon", "weapon", 10]];

export const levelFor = (xp: number) => LEVEL_XP.reduce((lvl, need, i) => (xp >= need ? i + 1 : lvl), 1);
export const nextLevelXp = (level: number): number | null => (level < MAX_LEVEL ? LEVEL_XP[level] : null);
export const masteryUnlocks = (champion: string) => MASTERY.map(([part, slot, level]) => ({ id: `mastery_${champion}_${part}`, slot, level }));
