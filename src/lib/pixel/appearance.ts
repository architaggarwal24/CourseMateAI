/**
 * A built-your-own look drawn on a champion: the appearance (lib/game/appearance.ts) becomes the rig's HumanoidLook.
 * The champion keeps its weapon (and so its fighting style); everything else - body, face, hair, outfit - comes
 * from the appearance. Shop skins then dress it as usual (skins.ts dressed()).
 */
import { CLOTH_COLORS, DEFAULT_HERO_LOOK, EYE_COLORS, HAIR_COLORS, METAL_CLOTH, SKIN_TONES, appearanceKey, type Appearance, type BuildId, type ClothColor } from "../game/appearance";
import { ramp, type Material } from "./color";
import { HEROES, type HeroDef, type Style } from "./heroes";
import { HERO_BUILD, type Build, type HumanoidLook, type WeaponKind } from "./rig";

export const BUILD_SHAPES: Record<BuildId, Build> = {
  slim: { ...HERO_BUILD, shoulderW: 11.5, waistW: 8, thighR: 3.4, shinR: 3.1, armR: 2.9, foreR: 2.5 },
  standard: HERO_BUILD,
  broad: { ...HERO_BUILD, shoulderW: 16, waistW: 10.5, armR: 3.4, foreR: 2.9, thighR: 4.4 },
};

/** A cloth material: light colours get extra contrast so their folds still show; metal colours shine on plate. */
export function cloth(id: ClothColor, opts: { plate?: boolean } = {}): Material {
  const hex = CLOTH_COLORS[id];
  const light = id === "white" || id === "ivory";
  return ramp(hex, { contrast: light ? 1.25 : 1, shiny: !!opts.plate && METAL_CLOTH.has(id) });
}

/** The champion wearing a built look (cached per champion + look, so the same look gives the same object). */
const cache = new Map<string, HeroDef>();
export function withAppearance(hero: HeroDef, a: Appearance | null | undefined): HeroDef {
  if (!a) return hero;
  const key = `${hero.skinKey ?? hero.id}~${appearanceKey(a)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const robe = a.outfit === "robe", coat = a.outfit === "coat", armor = a.outfit === "armor";
  const main = cloth(a.main, { plate: armor });
  const second = cloth(a.second, { plate: armor });
  const opt = (id: ClothColor | "none") => (id === "none" ? undefined : cloth(id));
  const hairHex = HAIR_COLORS[a.hairColor];
  const look: HumanoidLook = {
    ...hero.look,
    build: BUILD_SHAPES[a.build],
    skin: ramp(SKIN_TONES[a.skin]),
    eye: ramp(EYE_COLORS[a.eyes]),
    hair: { style: a.hair, mat: ramp(hairHex, { contrast: a.hairColor === "snow" ? 1.3 : a.hairColor === "black" ? 0.9 : 1 }) },
    topStyle: a.outfit,
    sleeves: a.sleeves,
    // coat / robe: the main colour is the coat, the second the shirt under it
    coat: coat || robe ? (robe ? cloth(a.main) : main) : undefined,
    coatLen: coat ? 20 : undefined,
    top: coat || robe ? cloth(a.second) : a.outfit === "tank" ? cloth(a.main) : main,
    sleeveMat: robe ? cloth(a.main) : armor ? second : undefined,
    pants: cloth(a.pants),
    baggy: a.outfit === "gi" || a.outfit === "tank",
    boots: cloth(a.boots, { plate: armor }),
    belt: cloth(a.trim, { plate: true }),
    trim: cloth(a.trim, { plate: true }),
    gloves: a.gloves === "none" ? undefined : cloth(a.gloves, { plate: armor }),
    cape: opt(a.cape),
    scarf: opt(a.scarf),
    pauldrons: armor ? (METAL_CLOTH.has(a.main) ? cloth(a.main === "gold" ? "gold" : "white", { plate: true }) : cloth(a.trim, { plate: true })) : undefined,
    headgear: undefined,
  };
  const out: HeroDef = { ...hero, look, custom: true, skinKey: key };
  cache.set(key, out);
  return out;
}

// ── your hero ────────────────────────────────────────────────────────────────────────────────────────────────
/** Your hero's fighting styles (server ids, game/kits.ts STYLES) as the rig draws them: stance, weapon, finish. */
export const HERO_STYLES: Record<string, { anim: Style; weapon: WeaponKind; from?: string; metal?: string; accent?: string; glow?: string; name: string }> = {
  apprentice: { anim: "sword", weapon: "sword", metal: "#cbd5e1", accent: "#78350f", name: "Apprentice Blade" },
  katana: { anim: "blade", weapon: "katana", from: "kaien", name: "Katana" },
  spear: { anim: "lance", weapon: "spear", from: "asha", name: "Spear" },
  fists: { anim: "fist", weapon: "gauntlets", from: "brak", name: "Fists" },
  staff: { anim: "mage", weapon: "staff", from: "mira", name: "Staff" },
  daggers: { anim: "twin", weapon: "daggers", from: "vex", name: "Twin Daggers" },
  greatsword: { anim: "heavy", weapon: "greatsword", from: "thorne", name: "Greatsword" },
  chain_whip: { anim: "whip", weapon: "whip", metal: "#94a3b8", accent: "#3f3f46", glow: "#e2e8f0", name: "Chain Whip" },
  war_fan: { anim: "fan", weapon: "fan", metal: "#e2e8f0", accent: "#b91c1c", glow: "#fbbf24", name: "War Fan" },
  twin_kamas: { anim: "kamas", weapon: "kamas", metal: "#e2e8f0", accent: "#78350f", name: "Twin Kamas" },
};

export const HERO_FIGHTER_ID = "hero";

/** Your hero as a fighter the sprite engine draws: its look on the rig, holding its style's weapon. */
export function heroFighter(o: { name?: string; style?: string | null; look?: Appearance | null }): HeroDef {
  const st = HERO_STYLES[o.style ?? "apprentice"] ?? HERO_STYLES.apprentice;
  const from = st.from ? HEROES.find((h) => h.id === st.from) : undefined;
  const look = o.look ?? DEFAULT_HERO_LOOK;
  const base: HeroDef = {
    id: HERO_FIGHTER_ID, name: o.name || "Your hero", title: st.name, blurb: "Built by you.", style: st.anim, accent: "#fbbf24",
    look: {
      ...(from?.look ?? HEROES[0].look),
      weapon: st.weapon,
      weaponMat: from?.look.weaponMat ?? ramp(st.metal ?? "#cbd5e1", { shiny: true }),
      weaponAccent: from?.look.weaponAccent ?? ramp(st.accent ?? "#78350f"),
      weaponGlow: from?.look.weaponGlow ?? (st.glow ? ramp(st.glow, { emissive: true }) : undefined),
    },
  };
  const h = withAppearance({ ...base, skinKey: `hero:${o.style ?? "apprentice"}` }, look);
  return { ...h, skinKey: `hero:${o.style ?? "apprentice"}:${appearanceKey(look)}`, name: base.name, title: base.title };
}
