/**
 * Champion skins: the shop's cosmetics, drawn on the pixel champions.
 *
 *   armor    -> an outfit palette (main / second / trim / dark, plus metal for plate). Each champion maps the
 *               palette onto its own outfit parts (Kaien's coat, Thorne's plate, Mira's robe and hood...).
 *   headgear -> a pixel head piece (circlet, helm, hood, crown, horns), drawn by rig.ts.
 *   weapon   -> a new finish for the champion's OWN weapon (metal + accent) and a rarity glow.
 *   pet      -> a small companion that idles beside the champion (pets.ts).
 *
 * Item ids are the shop's (backend/content/shop.json): nothing here changes what an item does in a fight or in
 * study; only how it looks. One loadout is shared by every champion and drawn to fit whichever one is picked.
 */
import { ramp, tint, type Material } from "./color";
import type { HeroDef } from "./heroes";
import type { HeadPiece, HumanoidLook } from "./rig";

export interface Loadout {
  armor?: string | null;
  headgear?: string | null;
  weapon?: string | null;
  pet?: string | null;
}

/** The rarities that light a weapon up (same tiers as lib/rarity.ts; common has no glow). */
export const RARITY_GLOW: Record<string, string> = { rare: "#60a5fa", epic: "#c084fc", legendary: "#facc15" };

// ── armor: outfit palettes ────────────────────────────────────────────────────

export interface OutfitPalette {
  /** The colour that reads first (coat, robe, gi, jacket, cape). */
  main: string;
  /** Second cloth (shirt under a coat, trousers). */
  second: string;
  /** Belts, sashes, scarves, trims. */
  trim: string;
  /** Boots, gloves, the darkest cloth. */
  dark: string;
  /** Plate (Thorne's armour, Asha's pauldrons). Cloth outfits leave the champion's own steel, tinted. */
  metal?: string;
  /** The trim glows (the two legendary outfits). */
  glow?: boolean;
}

export const ARMOR_SKINS: Record<string, OutfitPalette> = {
  armor_gi_white:       { main: "#e7e5e4", second: "#f5f5f4", trim: "#18181b", dark: "#292524" },
  armor_gi_red:         { main: "#b91c1c", second: "#7f1d1d", trim: "#f472b6", dark: "#3f0d0d" },
  armor_gi_blue:        { main: "#1d4ed8", second: "#1e3a8a", trim: "#facc15", dark: "#172554" },
  armor_shirt_basic:    { main: "#9ca3af", second: "#e5e7eb", trim: "#0ea5e9", dark: "#1f2937" },
  armor_hoodie_gray:    { main: "#52525b", second: "#3f3f46", trim: "#a1a1aa", dark: "#18181b" },
  armor_robe_blue:      { main: "#1e40af", second: "#172554", trim: "#facc15", dark: "#0f172a" },
  armor_jacket_cool:    { main: "#1c1917", second: "#292524", trim: "#dc2626", dark: "#0c0a09" },
  armor_wizard_purple:  { main: "#581c87", second: "#2e1065", trim: "#22d3ee", dark: "#1e1b4b" },
  armor_knight_silver:  { main: "#334155", second: "#475569", trim: "#38bdf8", dark: "#1e293b", metal: "#cbd5e1" },
  armor_knight_gold:    { main: "#f5f5f4", second: "#7f1d1d", trim: "#dc2626", dark: "#451a03", metal: "#eab308" },
  armor_dragon_scale:   { main: "#991b1b", second: "#450a0a", trim: "#f97316", dark: "#1c0606", metal: "#dc2626", glow: true },
  armor_legends_mantle: { main: "#312e81", second: "#1e1b4b", trim: "#67e8f9", dark: "#0f0a2a", metal: "#fde68a", glow: true },
  // mastery skins (champion Lv 3): worn only by their own champion
  mastery_kaien_outfit:  { main: "#1c1917", second: "#7f1d1d", trim: "#dc2626", dark: "#0c0a09" },
  mastery_asha_outfit:   { main: "#b45309", second: "#115e59", trim: "#5eead4", dark: "#422006", metal: "#d6a35c" },
  mastery_brak_outfit:   { main: "#57534e", second: "#292524", trim: "#f97316", dark: "#1c1917", glow: true },
  mastery_mira_outfit:   { main: "#1e1b4b", second: "#0f0a2a", trim: "#c7d2fe", dark: "#020617", glow: true },
  mastery_vex_outfit:    { main: "#3b0764", second: "#1e1b4b", trim: "#a855f7", dark: "#0c0a09" },
  mastery_thorne_outfit: { main: "#f8fafc", second: "#d6d3d1", trim: "#ca8a04", dark: "#78350f", metal: "#f1f5f9" },
};

const shiny = (h: string) => ramp(h, { shiny: true });

/** A built look (any outfit style on any champion), re-coloured from a palette by what it wears. */
function dressByStyle(look: HumanoidLook, p: OutfitPalette): HumanoidLook {
  const trim = p.glow ? ramp(p.trim, { emissive: true }) : ramp(p.trim);
  const metalOr = (own: Material | undefined) => (p.metal ? shiny(p.metal) : own ? tint(own, p.main, 0.18) : undefined);
  const out: HumanoidLook = { ...look, belt: trim, trim, boots: ramp(p.dark) };
  switch (look.topStyle) {
    case "coat": Object.assign(out, { coat: ramp(p.main, { contrast: 1.2 }), top: ramp(p.second), pants: ramp(p.dark) }); break;
    case "robe":
      Object.assign(out, { top: ramp(p.second), coat: ramp(p.main), sleeveMat: ramp(p.main), pants: ramp(p.dark), belt: p.glow ? trim : ramp(p.trim, { shiny: true }) });
      if (look.hair?.style === "hood") out.hair = { ...look.hair, mat: ramp(p.main) };
      break;
    case "armor":
      Object.assign(out, { top: p.metal ? shiny(p.metal) : ramp(p.main), sleeveMat: ramp(p.second), pants: ramp(p.second), pauldrons: metalOr(look.pauldrons) });
      break;
    case "gi": case "tank": Object.assign(out, { top: ramp(p.main), pants: ramp(p.dark), boots: ramp(p.second) }); break;
    default: Object.assign(out, { top: ramp(p.main), pants: ramp(p.dark) });
  }
  if (look.gloves) out.gloves = ramp(p.dark);
  if (look.scarf) out.scarf = trim;
  if (look.cape) out.cape = ramp(p.main);
  if (p.metal && !out.pauldrons) out.pauldrons = shiny(p.metal);
  return out;
}

/** Each champion's outfit, re-coloured from a palette. Only the parts that champion has are touched. */
function dressArmor(heroId: string, look: HumanoidLook, p: OutfitPalette): HumanoidLook {
  const trim = p.glow ? ramp(p.trim, { emissive: true }) : ramp(p.trim);
  const metalOr = (own: Material | undefined) => (p.metal ? shiny(p.metal) : own ? tint(own, p.main, 0.18) : undefined);
  const out: HumanoidLook = { ...look };
  switch (heroId) {
    case "kaien":
      Object.assign(out, { coat: ramp(p.main, { contrast: 1.2 }), top: ramp(p.second), pants: ramp(p.dark), belt: trim, boots: ramp(p.dark) });
      break;
    case "asha":
      Object.assign(out, { top: ramp(p.main), sleeveMat: ramp(p.second), pants: ramp(p.second), belt: trim, boots: ramp(p.dark), gloves: ramp(p.dark), pauldrons: metalOr(look.pauldrons) });
      break;
    case "brak":
      Object.assign(out, { top: ramp(p.main), pants: ramp(p.dark), belt: trim, boots: ramp(p.second) });
      break;
    case "mira":
      Object.assign(out, { top: ramp(p.second), coat: ramp(p.main), sleeveMat: ramp(p.main), pants: ramp(p.dark), boots: ramp(p.dark), belt: p.glow ? trim : ramp(p.trim, { shiny: true }) });
      if (look.hair?.style === "hood") out.hair = { ...look.hair, mat: ramp(p.main) };
      break;
    case "vex":
      Object.assign(out, { top: ramp(p.main), pants: ramp(p.dark), boots: ramp(p.dark), gloves: ramp(p.dark), scarf: trim });
      break;
    case "thorne": {
      const plate = metalOr(look.top)!;
      Object.assign(out, { top: plate, sleeveMat: metalOr(look.sleeveMat), boots: metalOr(look.boots), gloves: metalOr(look.gloves), pauldrons: metalOr(look.pauldrons), cape: ramp(p.main), pants: ramp(p.second), belt: trim });
      break;
    }
    default:
      Object.assign(out, { top: ramp(p.main), pants: ramp(p.second), boots: ramp(p.dark) });
  }
  out.trim = trim;
  // plate outfits read as plate on everyone: metal pauldrons on champions who have none of their own
  if (p.metal && !out.pauldrons) out.pauldrons = shiny(p.metal);
  return out;
}

// ── headgear: head pieces ─────────────────────────────────────────────────────

const glow = (h: string) => ramp(h, { emissive: true });

export const HEAD_SKINS: Record<string, () => HeadPiece> = {
  hat_headband_red:   () => ({ kind: "circlet", cloth: true, mat: ramp("#dc2626"), trim: ramp("#b91c1c") }),
  hat_headband_blue:  () => ({ kind: "circlet", cloth: true, mat: ramp("#2563eb"), trim: ramp("#1d4ed8") }),
  hat_headband_white: () => ({ kind: "circlet", cloth: true, mat: ramp("#f5f5f4", { contrast: 1.3 }), trim: ramp("#e7e5e4", { contrast: 1.3 }) }),
  hat_baseball_red:   () => ({ kind: "hood", mat: ramp("#b91c1c") }),
  hat_beanie_blue:    () => ({ kind: "hood", mat: ramp("#0369a1"), point: true }),
  hat_headphones:     () => ({ kind: "helm", mat: shiny("#475569"), trim: glow("#22d3ee") }),
  hat_wizard:         () => ({ kind: "hood", mat: ramp("#6d28d9"), point: true }),
  hat_crown_bronze:   () => ({ kind: "crown", mat: shiny("#b45309"), trim: glow("#4ade80") }),
  hat_ninja:          () => ({ kind: "hood", mat: ramp("#18181b", { contrast: 0.9 }), mask: true, trim: ramp("#27272a") }),
  hat_crown_silver:   () => ({ kind: "crown", mat: shiny("#cbd5e1"), trim: glow("#38bdf8") }),
  hat_samurai:        () => ({ kind: "helm", mat: shiny("#1f2937"), trim: ramp("#b91c1c"), horns: shiny("#e7e5e4") }),
  hat_crown_gold:     () => ({ kind: "crown", mat: shiny("#eab308"), trim: glow("#f43f5e") }),
  // mastery skins (champion Lv 6)
  mastery_kaien_head:  () => ({ kind: "circlet", cloth: true, mat: ramp("#18181b", { contrast: 0.9 }), trim: ramp("#dc2626") }),
  mastery_asha_head:   () => ({ kind: "circlet", mat: shiny("#eab308"), trim: glow("#fb923c") }),
  mastery_brak_head:   () => ({ kind: "horns", mat: shiny("#7c2d12") }),
  mastery_mira_head:   () => ({ kind: "hood", mat: ramp("#1e1b4b"), point: true }),
  mastery_vex_head:    () => ({ kind: "hood", mat: ramp("#4c1d95"), mask: true, trim: ramp("#2e1065") }),
  mastery_thorne_head: () => ({ kind: "helm", mat: shiny("#e2e8f0"), trim: shiny("#eab308") }),
};

// ── weapons: finishes ─────────────────────────────────────────────────────────

/** `glow`: a glow of its own (mastery weapons), whatever the rarity. */
export interface WeaponFinish { metal: string; accent: string; glow?: string }

export const WEAPON_SKINS: Record<string, WeaponFinish> = {
  weapon_pencil:          { metal: "#6b7280", accent: "#eab308" },
  weapon_ruler:           { metal: "#e5e7eb", accent: "#a16207" },
  weapon_sword_bronze:    { metal: "#d08a4a", accent: "#7c2d12" },
  weapon_bow:             { metal: "#e7e5e4", accent: "#57534e" },
  weapon_staff_wood:      { metal: "#fdba74", accent: "#7c2d12" },
  weapon_sword_silver:    { metal: "#e0f2fe", accent: "#1e3a8a" },
  weapon_hammer:          { metal: "#64748b", accent: "#facc15" },
  weapon_staff_crystal:   { metal: "#67e8f9", accent: "#0e7490" },
  weapon_sword_excalibur: { metal: "#f8fafc", accent: "#ca8a04" },
  weapon_staff_legendary: { metal: "#fb923c", accent: "#450a0a" },
  // mastery skins (champion Lv 10)
  mastery_kaien_weapon:  { metal: "#3f3f46", accent: "#7f1d1d", glow: "#ef4444" },
  mastery_asha_weapon:   { metal: "#fef3c7", accent: "#b45309", glow: "#fb923c" },
  mastery_brak_weapon:   { metal: "#78716c", accent: "#292524", glow: "#f97316" },
  mastery_mira_weapon:   { metal: "#e0e7ff", accent: "#312e81", glow: "#e0e7ff" },
  mastery_vex_weapon:    { metal: "#ddd6fe", accent: "#3b0764", glow: "#a855f7" },
  mastery_thorne_weapon: { metal: "#fefce8", accent: "#a16207", glow: "#facc15" },
};

/** The champion a mastery skin belongs to (ids are mastery_<champion>_<part>), or null for a shop skin. */
export function masteryOwner(itemId: string | null | undefined): string | null {
  const m = /^mastery_([a-z]+)_/.exec(itemId ?? "");
  return m ? m[1] : null;
}

function dressWeapon(look: HumanoidLook, f: WeaponFinish, rarity?: string | null): HumanoidLook {
  const out: HumanoidLook = { ...look, weaponMat: shiny(f.metal), weaponAccent: ramp(f.accent) };
  const g = f.glow ?? (rarity ? RARITY_GLOW[rarity] : undefined);
  if (g) out.weaponGlow = ramp(g, { emissive: true });
  return out;
}

// ── the dressed champion ──────────────────────────────────────────────────────

/** Ids this module knows how to draw, per slot (the shop's wearables). */
export function hasSkin(itemId: string): boolean {
  return itemId in ARMOR_SKINS || itemId in HEAD_SKINS || itemId in WEAPON_SKINS;
}

/** The stable signature of a loadout (frame caches key on it). */
export function loadoutKey(heroId: string, l: Loadout, weaponRarity?: string | null): string {
  return [heroId, l.armor ?? "", l.headgear ?? "", l.weapon ?? "", weaponRarity ?? ""].join("|");
}

/**
 * The champion wearing a loadout. Unknown or empty slots keep the champion's own look; the weapon glows in its
 * rarity's colour. The pet is not part of the figure (it is its own sprite, see pets.ts).
 */
/**
 * Forge tiers on the figure (forge.ts): a weapon at tier IV glows in its own metal's light and at V burns brighter;
 * an outfit gains a trim at II and a lit trim at IV. `tiers` maps item ids (and `style:<id>` for your hero's base
 * weapon) to I-V.
 */
export function forged(hero: HeroDef, loadout: Loadout, tiers: Record<string, number> | undefined, heroStyle?: string | null): HeroDef {
  if (!tiers) return hero;
  const wt = tiers[loadout.weapon ?? (heroStyle ? `style:${heroStyle}` : "")] ?? 1;
  const at = tiers[loadout.armor ?? ""] ?? 1;
  if (wt < 4 && at < 2) return hero;
  const look = { ...hero.look };
  if (wt >= 4 && look.weaponMat && !look.weaponGlow) look.weaponGlow = ramp(toHex(look.weaponMat.ramp[wt >= 5 ? 4 : 3]), { emissive: true });
  if (at >= 2 && !look.trim) look.trim = look.belt ?? ramp("#facc15", { shiny: true });
  if (at >= 4 && look.trim && !look.trim.emissive) look.trim = { ...look.trim, emissive: true };
  return { ...hero, look, skinKey: `${hero.skinKey ?? hero.id}|f${wt}${at}` };
}
const toHex = (c: number) => `#${[c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map((x) => x.toString(16).padStart(2, "0")).join("")}`;

export function dressed(hero: HeroDef, loadout: Loadout, rarities: { weapon?: string | null } = {}): HeroDef {
  // another champion's mastery skin is not drawn (the server takes it off on a switch; this covers the moment between)
  const mine = (id?: string | null) => (id && (masteryOwner(id) ?? hero.id) === hero.id ? id : null);
  const l: Loadout = { armor: mine(loadout.armor), headgear: mine(loadout.headgear), weapon: mine(loadout.weapon), pet: loadout.pet };
  let look = hero.look;
  const a = l.armor ? ARMOR_SKINS[l.armor] : undefined;
  if (a) look = hero.custom ? dressByStyle(look, a) : dressArmor(hero.id, look, a);
  const h = l.headgear ? HEAD_SKINS[l.headgear] : undefined;
  if (h) look = { ...look, headgear: h() };
  const w = l.weapon ? WEAPON_SKINS[l.weapon] : undefined;
  if (w) look = dressWeapon(look, w, rarities.weapon);
  else if (rarities.weapon && RARITY_GLOW[rarities.weapon]) look = { ...look, weaponGlow: ramp(RARITY_GLOW[rarities.weapon], { emissive: true }) };
  if (look === hero.look) return hero;
  return { ...hero, look, skinKey: `${hero.skinKey ? `${hero.skinKey}|` : ""}${loadoutKey(hero.id, l, rarities.weapon)}` };
}
