// What a hero looks like, as data: the pieces the character is assembled from and the colour choices for each.
// The art itself (SVG) lives in components/avatar/art; this file is only ids, palettes and the equipped-slots mapping.
import palettes from "./palettes.json";

export interface SkinTone { id: string; label: string; b: string; m: string; d: string; o: string }
export interface HairColor { id: string; label: string; c: string; h: string }
export interface EyeColor { id: string; label: string; iris: string; pupil: string }
export interface LipColor { id: string; label: string; color: string }

export const SKIN_TONES: readonly SkinTone[] = palettes.skin;
export const HAIR_COLORS: readonly HairColor[] = palettes.hair;
export const EYE_COLORS: readonly EyeColor[] = palettes.eyes;
export const LIP_COLORS: readonly LipColor[] = palettes.lips;

export const BODY_TYPES = [
  { id: "male_default", label: "Slim", desc: "Lean and quick" },
  { id: "male_athletic", label: "Strong", desc: "Broad and powerful" },
  { id: "female_elegant", label: "Graceful", desc: "Poised and sharp" },
  { id: "female_sporty", label: "Athletic", desc: "Light on her feet" },
] as const;
export type BodyTypeId = (typeof BODY_TYPES)[number]["id"];

/** Everything that decides how the hero is drawn. Empty string = nothing in that slot. */
export interface Look {
  bodyTypeId: string;
  skinId: string;
  hairId: string;
  eyeColorId: string;
  lipColorId: string;
  armorId: string;
  headId: string;
  weaponId: string;
  petId: string;
}

export const DEFAULT_LOOK: Look = {
  bodyTypeId: "male_default", skinId: "ivory", hairId: "black", eyeColorId: "blue", lipColorId: "natural",
  armorId: "armor_shirt_basic", headId: "", weaponId: "", petId: "",
};

/** The equipped slots the API uses (GET /avatar, GET /shop) -> a Look. Anything missing falls back to the default. */
export function lookFromEquipped(eq: Record<string, string | undefined> | null | undefined): Look {
  const e = eq ?? {};
  return {
    bodyTypeId: e.body_type_id || DEFAULT_LOOK.bodyTypeId,
    skinId: e.skin_id || DEFAULT_LOOK.skinId,
    hairId: e.hair_id || DEFAULT_LOOK.hairId,
    eyeColorId: e.eye_color_id || DEFAULT_LOOK.eyeColorId,
    lipColorId: e.lip_color_id || DEFAULT_LOOK.lipColorId,
    armorId: e.armor || e.outfit_id || DEFAULT_LOOK.armorId,
    headId: e.headgear || "",
    weaponId: e.weapon || "",
    petId: e.pet || "",
  };
}

const pick = <T extends { id: string }>(list: readonly T[], id: string): T => list.find((x) => x.id === id) ?? list[0];
export const skinOf = (id: string) => pick(SKIN_TONES, id);
export const hairOf = (id: string) => pick(HAIR_COLORS, id);
export const eyeOf = (id: string) => pick(EYE_COLORS, id);
export const lipOf = (id: string) => pick(LIP_COLORS, id);

/** Proportions of the four body types (SVG units, hero is 200 wide and centred on x = 100). */
export interface BodyParams {
  /** shoulder / waist / hip widths */
  sw: number; ww: number; hw: number;
  /** arm and leg thickness */
  arm: number; leg: number;
  head: "male" | "female" | "sporty";
  female: boolean;
}
export const BODY: Record<string, BodyParams> = {
  male_default: { sw: 64, ww: 54, hw: 56, arm: 15, leg: 18, head: "male", female: false },
  male_athletic: { sw: 90, ww: 68, hw: 62, arm: 25, leg: 22, head: "male", female: false },
  female_elegant: { sw: 58, ww: 42, hw: 66, arm: 14, leg: 19, head: "female", female: true },
  female_sporty: { sw: 62, ww: 48, hw: 56, arm: 15, leg: 18, head: "sporty", female: true },
};
export const bodyOf = (id: string): BodyParams => BODY[id] ?? BODY.male_default;
