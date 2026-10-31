// The avatar's art, as data. Every sprite is JSON (./data/*.json): rows of characters plus a palette, where a palette
// value is either a literal colour or a token ("$skin.b", "$hair.c", "$eye.iris", "$lip.color") that the renderer fills
// in per hero. There is no pixel array in code: to change a sprite, edit the JSON.
import palettes from "./data/palettes.json";
import layoutData from "./data/layout.json";
import bodiesData from "./data/bodies.json";
import outfitsData from "./data/outfits.json";
import gearData from "./data/gear.json";
import iconsData from "./data/icons.json";

/** A sprite trimmed to its painted area: `rows` use "." for transparent; (x, y) is where the rows sit inside a `w`-wide sprite. */
export interface SpriteData { w: number; x: number; y: number; rows: string[]; palette: Record<string, string> }

export interface SkinTone { id: string; label: string; b: string; m: string; d: string; o: string }
export interface HairColor { id: string; label: string; c: string; h: string }
export interface EyeColor { id: string; label: string; iris: string; pupil: string }
export interface LipColor { id: string; label: string; color: string }

export const SKIN_TONES: readonly SkinTone[] = palettes.skin;
export const HAIR_COLORS: readonly HairColor[] = palettes.hair;
export const EYE_COLORS: readonly EyeColor[] = palettes.eyes;
export const LIP_COLORS: readonly LipColor[] = palettes.lips;

type Arms = { down: SpriteData; up: SpriteData };
type Sprites = Record<string, SpriteData>;

export const LAYOUT = layoutData as typeof layoutData & { armX: Record<string, { L: number; R: number }> };
export const HEADS = bodiesData.heads as Record<"male" | "female" | "femaleSporty", SpriteData>;
export const ARMS = bodiesData.arms as Record<"default" | "skinny" | "muscular", Arms>;
export const OUTFITS = outfitsData as unknown as { default: Sprites; female: Sprites; byBody: Record<string, Sprites> };
export const HEADGEAR = gearData.headgear as Sprites;
export const WEAPONS = gearData.weapons as Sprites;
export const PETS = gearData.pets as { small: Sprites; mount: Sprites };
export const ICONS = iconsData as Sprites;

export type BodyShape = { head: keyof typeof HEADS; arms: keyof typeof ARMS; female: boolean };
export const bodyShape = (bodyTypeId?: string): BodyShape =>
  ((LAYOUT.bodyTypes as Record<string, BodyShape>)[bodyTypeId ?? ""] ?? LAYOUT.bodyTypes.default) as BodyShape;
