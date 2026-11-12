/**
 * Build your own fighter: how a champion LOOKS, chosen by the player (skin, eyes, hair, build, outfit and its
 * colours). Pure data, shared by the server (which validates and stores it) and the pixel engine (which draws it,
 * see lib/pixel/appearance.ts). It never changes how a champion fights: the fighting style, weapon, kit and
 * mastery stay the champion's own.
 *
 * Every choice is an id from the lists below, so a saved look can't carry anything the engine can't draw.
 */

export const SKIN_TONES = {
  porcelain: "#f7d7c0", light: "#f2c39c", warm: "#e8b089", tan: "#d99a6c", bronze: "#b5774f", deep: "#9c6040", umber: "#6e4229",
} as const;

export const EYE_COLORS = {
  sky: "#38bdf8", blue: "#60a5fa", violet: "#a78bfa", green: "#4ade80", amber: "#f59e0b", gold: "#fbbf24", red: "#ef4444", grey: "#94a3b8", brown: "#92400e",
} as const;

export const HAIR_COLORS = {
  ink: "#1e1b4b", black: "#18181b", brown: "#78350f", auburn: "#9a3412", crimson: "#b91c1c", gold: "#fbbf24", snow: "#e7e5e4",
  silver: "#94a3b8", violet: "#5b21b6", blue: "#2563eb", teal: "#0d9488", pink: "#f472b6",
} as const;

/** One palette for every piece of cloth (outfit main / second / trim, trousers, boots, gloves, cape, scarf). */
export const CLOTH_COLORS = {
  white: "#e5e7eb", ivory: "#f5f5f4", steel: "#94a3b8", gunmetal: "#64748b", slate: "#334155", charcoal: "#1f2937", graphite: "#27272a",
  black: "#1c1917", umber: "#292524", stone: "#57534e", leather: "#78350f", amber: "#d97706", gold: "#facc15", orange: "#ea580c",
  red: "#dc2626", crimson: "#b91c1c", rose: "#e11d48", pink: "#f472b6", orchid: "#a855f7", violet: "#6d28d9", indigo: "#312e81",
  night: "#1e1b4b", royal: "#1d4ed8", ocean: "#0369a1", teal: "#0f766e", pine: "#134e4a", forest: "#14532d", moss: "#65a30d",
} as const;

/** Cloth that reads as metal: plate armour in these colours shines. */
export const METAL_CLOTH: ReadonlySet<string> = new Set(["steel", "gunmetal", "gold", "white"]);

export const HAIR_STYLES = ["spiky", "ponytail", "bob", "wild", "slick", "topknot", "hood"] as const;
export const BUILDS = ["slim", "standard", "broad"] as const;
export const OUTFITS = ["coat", "gi", "armor", "robe", "jacket", "tank"] as const;
export const SLEEVES = ["long", "short", "none"] as const;

export type SkinTone = keyof typeof SKIN_TONES;
export type EyeColor = keyof typeof EYE_COLORS;
export type HairColor = keyof typeof HAIR_COLORS;
export type ClothColor = keyof typeof CLOTH_COLORS;
export type HairStyle = (typeof HAIR_STYLES)[number];
export type BuildId = (typeof BUILDS)[number];
export type OutfitId = (typeof OUTFITS)[number];
export type SleeveId = (typeof SLEEVES)[number];

export interface Appearance {
  skin: SkinTone;
  eyes: EyeColor;
  hair: HairStyle;
  hairColor: HairColor;
  build: BuildId;
  outfit: OutfitId;
  sleeves: SleeveId;
  main: ClothColor;
  second: ClothColor;
  trim: ClothColor;
  pants: ClothColor;
  boots: ClothColor;
  gloves: ClothColor | "none";
  cape: ClothColor | "none";
  scarf: ClothColor | "none";
}

/** The six champions' own looks, as appearances: the starter looks a fighter can be built from. */
export const STARTER_LOOKS: Record<string, Appearance> = {
  kaien: { skin: "light", eyes: "sky", hair: "spiky", hairColor: "ink", build: "standard", outfit: "coat", sleeves: "long", main: "white", second: "charcoal", trim: "slate", pants: "slate", boots: "black", gloves: "none", cape: "none", scarf: "none" },
  asha: { skin: "tan", eyes: "amber", hair: "ponytail", hairColor: "crimson", build: "slim", outfit: "armor", sleeves: "short", main: "teal", second: "pine", trim: "amber", pants: "pine", boots: "leather", gloves: "leather", cape: "none", scarf: "none" },
  brak: { skin: "deep", eyes: "gold", hair: "wild", hairColor: "snow", build: "broad", outfit: "gi", sleeves: "none", main: "crimson", second: "graphite", trim: "gold", pants: "graphite", boots: "stone", gloves: "none", cape: "none", scarf: "none" },
  mira: { skin: "light", eyes: "violet", hair: "hood", hairColor: "violet", build: "slim", outfit: "robe", sleeves: "long", main: "violet", second: "indigo", trim: "gold", pants: "night", boots: "night", gloves: "none", cape: "none", scarf: "none" },
  vex: { skin: "tan", eyes: "green", hair: "bob", hairColor: "black", build: "slim", outfit: "jacket", sleeves: "long", main: "forest", second: "black", trim: "rose", pants: "black", boots: "umber", gloves: "umber", cape: "none", scarf: "rose" },
  thorne: { skin: "light", eyes: "blue", hair: "slick", hairColor: "gold", build: "standard", outfit: "armor", sleeves: "long", main: "steel", second: "gunmetal", trim: "gold", pants: "slate", boots: "gunmetal", gloves: "gunmetal", cape: "royal", scarf: "none" },
};

/** Your hero's look until the player builds one. */
export const DEFAULT_HERO_LOOK: Appearance = {
  skin: "warm", eyes: "brown", hair: "bob", hairColor: "brown", build: "standard", outfit: "jacket", sleeves: "long",
  main: "ocean", second: "charcoal", trim: "amber", pants: "slate", boots: "leather", gloves: "none", cape: "none", scarf: "none",
};

export const starterLook = (championId: string): Appearance => ({ ...(STARTER_LOOKS[championId] ?? STARTER_LOOKS.kaien) });

const oneOf = <T extends string>(list: readonly T[] | Record<T, unknown>, v: unknown): v is T =>
  typeof v === "string" && (Array.isArray(list) ? (list as readonly string[]).includes(v) : Object.prototype.hasOwnProperty.call(list, v));

/**
 * A look the engine can draw, or null. Every field must be present and one of its choices; anything else in the
 * object is dropped.
 */
export function cleanAppearance(raw: unknown): Appearance | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const optional = (v: unknown) => v === "none" || oneOf(CLOTH_COLORS, v);
  if (!oneOf(SKIN_TONES, r.skin) || !oneOf(EYE_COLORS, r.eyes) || !oneOf(HAIR_STYLES, r.hair) || !oneOf(HAIR_COLORS, r.hairColor)
    || !oneOf(BUILDS, r.build) || !oneOf(OUTFITS, r.outfit) || !oneOf(SLEEVES, r.sleeves)
    || !oneOf(CLOTH_COLORS, r.main) || !oneOf(CLOTH_COLORS, r.second) || !oneOf(CLOTH_COLORS, r.trim)
    || !oneOf(CLOTH_COLORS, r.pants) || !oneOf(CLOTH_COLORS, r.boots)
    || !optional(r.gloves) || !optional(r.cape) || !optional(r.scarf)) return null;
  return {
    skin: r.skin, eyes: r.eyes, hair: r.hair, hairColor: r.hairColor, build: r.build, outfit: r.outfit, sleeves: r.sleeves,
    main: r.main, second: r.second, trim: r.trim, pants: r.pants, boots: r.boots,
    gloves: r.gloves as Appearance["gloves"], cape: r.cape as Appearance["cape"], scarf: r.scarf as Appearance["scarf"],
  };
}

/** Saved looks per champion: only real champions with a valid look survive. */
export function cleanLooks(raw: unknown, champions: readonly string[]): Record<string, Appearance> {
  const out: Record<string, Appearance> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [cid, v] of Object.entries(raw as Record<string, unknown>)) {
    const a = champions.includes(cid) ? cleanAppearance(v) : null;
    if (a) out[cid] = a;
  }
  return out;
}

/** A stable short signature of a look (sprite caches key on it). */
export function appearanceKey(a: Appearance): string {
  return [a.skin, a.eyes, a.hair, a.hairColor, a.build, a.outfit, a.sleeves, a.main, a.second, a.trim, a.pants, a.boots, a.gloves, a.cape, a.scarf].join(".");
}

export const sameAppearance = (a: Appearance, b: Appearance) => appearanceKey(a) === appearanceKey(b);
