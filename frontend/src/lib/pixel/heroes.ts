/**
 * The hero roster: six original fighters drawn with the humanoid rig, each with a fighting style that decides how
 * they stand, strike, guard, cast, fall and celebrate.
 */
import { hex, ramp, tint, type Material } from "./color";
import { HERO_BUILD, type HumanoidLook, type Pose } from "./rig";

export type AnimName = "idle" | "attack" | "hit" | "guard" | "cast" | "ko" | "win" | "dash";
export type Style = "blade" | "heavy" | "lance" | "fist" | "mage" | "twin";

export interface HeroDef {
  id: string;
  name: string;
  title: string;
  /** One line for the roster card. */
  blurb: string;
  style: Style;
  /** The roster card's accent (CSS colour). */
  accent: string;
  look: HumanoidLook;
}

const skinLight = ramp("#f2c39c"), skinTan = ramp("#d99a6c"), skinDeep = ramp("#9c6040");

export const HEROES: HeroDef[] = [
  {
    id: "kaien", name: "Kaien", title: "Ronin of the Ninth Page", style: "blade", accent: "#5eead4",
    blurb: "A wandering swordsman. Fast, precise strikes.",
    look: {
      build: HERO_BUILD, scale: 1, skin: skinLight, eye: ramp("#38bdf8"),
      top: ramp("#1f2937"), topStyle: "coat", coat: ramp("#e5e7eb", { contrast: 1.2 }), coatLen: 20, sleeves: "long",
      pants: ramp("#334155"), boots: ramp("#1c1917"), belt: ramp("#dc2626"),
      hair: { style: "spiky", mat: ramp("#1e1b4b") },
      weapon: "katana", weaponMat: ramp("#cbd5e1", { shiny: true }), weaponAccent: ramp("#7f1d1d"),
    },
  },
  {
    id: "asha", name: "Asha", title: "Lancer of the Dawn Wall", style: "lance", accent: "#fb923c",
    blurb: "Keeps foes at spear's length. Strong reach.",
    look: {
      build: { ...HERO_BUILD, shoulderW: 12, waistW: 8, thighR: 3.3 }, scale: 1, skin: skinTan, eye: ramp("#f59e0b"),
      top: ramp("#0f766e"), topStyle: "armor", sleeves: "short", sleeveMat: ramp("#115e59"),
      pants: ramp("#134e4a"), boots: ramp("#78350f"), belt: ramp("#d97706"), pauldrons: ramp("#d97706", { shiny: true }),
      gloves: ramp("#78350f"),
      hair: { style: "ponytail", mat: ramp("#b91c1c") },
      weapon: "spear", weaponMat: ramp("#e2e8f0", { shiny: true }), weaponAccent: ramp("#78350f"), weaponGlow: ramp("#f97316"),
    },
  },
  {
    id: "brak", name: "Brak", title: "Iron-Fist of the Lower Stacks", style: "fist", accent: "#f87171",
    blurb: "Bare-knuckle brawler. Huge combos.",
    look: {
      build: { ...HERO_BUILD, shoulderW: 15, armR: 3.2, foreR: 2.8, waistW: 10 }, scale: 1, skin: skinDeep, eye: ramp("#fbbf24"),
      top: ramp("#b91c1c"), topStyle: "gi", sleeves: "none",
      pants: ramp("#27272a"), baggy: true, boots: ramp("#57534e"), belt: ramp("#0a0a0a"),
      hair: { style: "wild", mat: ramp("#e7e5e4", { contrast: 1.3 }) },
      weapon: "gauntlets", weaponMat: ramp("#94a3b8", { shiny: true }),
    },
  },
  {
    id: "mira", name: "Mira", title: "Arcanist of the Quiet Stacks", style: "mage", accent: "#c084fc",
    blurb: "Channels what she has read into raw magic.",
    look: {
      build: { ...HERO_BUILD, shoulderW: 11, waistW: 8 }, scale: 1, skin: skinLight, eye: ramp("#a78bfa"),
      top: ramp("#312e81"), topStyle: "robe", coat: ramp("#6d28d9"), sleeves: "long", sleeveMat: ramp("#6d28d9"),
      pants: ramp("#1e1b4b"), boots: ramp("#1e1b4b"), belt: ramp("#facc15", { shiny: true }),
      hair: { style: "hood", mat: ramp("#5b21b6") },
      weapon: "staff", weaponMat: ramp("#a78bfa"), weaponAccent: ramp("#78350f"), weaponGlow: ramp("#67e8f9", { emissive: true }),
    },
  },
  {
    id: "vex", name: "Vex", title: "Shadow of the Margins", style: "twin", accent: "#4ade80",
    blurb: "Twin daggers, never in one place for long.",
    look: {
      build: { ...HERO_BUILD, shoulderW: 11, waistW: 8, thighR: 3.3 }, scale: 1, skin: skinTan, eye: ramp("#4ade80"),
      top: ramp("#14532d"), topStyle: "jacket", sleeves: "long",
      pants: ramp("#1c1917"), boots: ramp("#292524"), gloves: ramp("#292524"), scarf: ramp("#e11d48"),
      hair: { style: "bob", mat: ramp("#18181b", { contrast: 0.9 }) },
      weapon: "daggers", weaponMat: ramp("#e2e8f0", { shiny: true }), weaponAccent: ramp("#3f3f46"),
    },
  },
  {
    id: "thorne", name: "Thorne", title: "Knight of the Last Chapter", style: "heavy", accent: "#60a5fa",
    blurb: "Slow, armoured, hits like a closing book.",
    look: {
      build: { ...HERO_BUILD, shoulderW: 15, waistW: 10, armR: 3, thighR: 3.9, shinR: 3.1 }, scale: 1, skin: skinLight, eye: ramp("#60a5fa"),
      top: ramp("#94a3b8", { shiny: true }), topStyle: "armor", sleeves: "long", sleeveMat: ramp("#64748b", { shiny: true }),
      pants: ramp("#475569"), boots: ramp("#64748b", { shiny: true }), gloves: ramp("#64748b", { shiny: true }), belt: ramp("#78350f"),
      cape: ramp("#1d4ed8"), pauldrons: ramp("#cbd5e1", { shiny: true }),
      hair: { style: "slick", mat: ramp("#fbbf24") },
      weapon: "greatsword", weaponMat: ramp("#e2e8f0", { shiny: true }), weaponAccent: ramp("#1e3a8a"), weaponGlow: ramp("#93c5fd", { emissive: true }),
    },
  },
];

export const DEFAULT_HERO = "kaien";
export const heroById = (id: string | null | undefined): HeroDef => HEROES.find((h) => h.id === id) ?? HEROES[0];

/** A hero with gear applied: a weapon of a rarity glows in that rarity's colour; armour tints the outfit slightly. */
export function geared(hero: HeroDef, gear: { weaponRarity?: string | null; armorRarity?: string | null }): HeroDef {
  const glowFor: Record<string, string> = { rare: "#60a5fa", epic: "#c084fc", legendary: "#facc15" };
  const look = { ...hero.look };
  const w = gear.weaponRarity && glowFor[gear.weaponRarity];
  if (w) look.weaponGlow = ramp(w, { emissive: true });
  const a = gear.armorRarity && glowFor[gear.armorRarity];
  if (a) {
    const t = (m?: Material) => (m ? tint(m, a, 0.18) : m);
    look.top = t(look.top)!; look.coat = t(look.coat); look.sleeveMat = t(look.sleeveMat);
  }
  return { ...hero, look };
}

// ── animations ────────────────────────────────────────────────────────────────

/** The fighting stance each style idles in. */
const STANCE: Record<Style, Pose> = {
  blade: { lean: 8, head: -4, fs: 30, fe: 70, wpn: 32, bs: 45, be: 60, fh: 26, fk: -24, bh: -16, bk: -10, y: 2 },
  heavy: { lean: 4, head: -2, fs: 30, fe: 70, wpn: 88, bs: 35, be: 80, fh: 22, fk: -18, bh: -18, bk: -8, y: 2 },
  lance: { lean: 6, head: -3, fs: 50, fe: 35, wpn: 22, bs: 55, be: 35, fh: 28, fk: -20, bh: -20, bk: -10, y: 2 },
  fist: { lean: 10, head: -6, fs: 40, fe: 85, bs: 25, be: 105, fh: 24, fk: -22, bh: -20, bk: -12, y: 3 },
  mage: { lean: 2, head: -2, fs: 25, fe: 60, wpn: 95, bs: 20, be: 40, fh: 12, fk: -6, bh: -10, bk: -4, y: 0 },
  twin: { lean: 14, head: -8, fs: 40, fe: 55, wpn: 10, bs: 30, be: 75, fh: 30, fk: -30, bh: -22, bk: -14, y: 4 },
};

const m = (base: Pose, over: Pose): Pose => ({ ...base, ...over });

export function heroAnims(style: Style): Record<AnimName, Pose[]> {
  const st = STANCE[style];
  const idle = [0, 1, 2, 1].map((i) => m(st, { y: (st.y ?? 0) + i * 0.8, sway: [0, 0.3, 0.5, 0.3][i], fs: (st.fs ?? 0) + i * 1.5, bs: (st.bs ?? 0) - i }));
  const hit = [m(st, { lean: -14, head: 14, x: -3, fs: 15, fe: 30, bs: -20, be: 40, eyes: "hurt", fh: 10, bh: -30, sway: 1, shout: true }),
    m(st, { lean: -6, head: 6, x: -2, eyes: "hurt", sway: 0.6 })];
  const ko = [hit[0], m(hit[0], { fall: -25, x: -4 }), m(hit[0], { fall: -60, x: -6, eyes: "closed" }), m(hit[0], { fall: -88, x: -6, y: 4, eyes: "closed", sway: -0.4 })];
  const dash = [m(st, { lean: 30, x: 4, fh: 50, fk: -50, bh: -45, bk: -30, sway: -1 }), m(st, { lean: 26, x: 8, fh: 10, fk: -60, bh: -20, bk: -60, sway: -1 })];

  switch (style) {
    case "blade":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { lean: -6, fs: 160, fe: 25, wpn: -10, bs: 40, y: 3, fh: 30, bh: -24, eyes: "angry" }),
          m(st, { x: 10, lean: 22, fs: 125, fe: 15, wpn: 0, fh: 48, fk: -12, bh: -38, bk: -22, y: 4, sway: -1, shout: true, eyes: "angry" }),
          m(st, { x: 16, lean: 26, fs: 70, fe: 0, wpn: 10, fh: 50, fk: -10, bh: -40, bk: -20, y: 5, sway: -1, eyes: "angry" }),
          m(st, { x: 16, lean: 22, fs: 15, fe: 10, wpn: 40, fh: 48, fk: -12, bh: -38, bk: -20, y: 5, sway: -0.6 }),
          m(st, { x: 8, fs: 35, fe: 40, wpn: -10 }),
        ],
        guard: [m(st, { lean: 0, fs: 75, fe: 75, wpn: -95, bs: 70, be: 90, x: -2, eyes: "angry" }), m(st, { lean: -2, fs: 75, fe: 75, wpn: -95, bs: 70, be: 90, x: -3, eyes: "angry" })],
        cast: [m(st, { fs: 95, fe: 0, wpn: 85, eyes: "closed", glow: 0 }), m(st, { fs: 95, fe: 0, wpn: 85, glow: 1, eyes: "angry" }), m(st, { fs: 130, fe: 0, wpn: 45, glow: 1.5, x: 4, shout: true })],
        win: [m(st, { lean: 0, fs: 170, fe: 5, wpn: 0, bs: -10, be: 10, fh: 10, bh: -10, fk: 0, bk: 0, y: 0 }), m(st, { lean: 0, fs: 172, fe: 3, wpn: 0, bs: -10, be: 10, fh: 10, bh: -10, fk: 0, bk: 0, y: 0, sway: 0.8 })],
      };
    case "heavy":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { lean: -10, fs: 175, fe: 10, wpn: 0, bs: 165, be: 10, y: 3, eyes: "angry" }),
          m(st, { lean: -4, fs: 185, fe: 0, wpn: 10, bs: 175, be: 5, y: 2, x: 4, eyes: "angry", shout: true }),
          m(st, { x: 14, lean: 30, fs: 90, fe: 0, wpn: 0, bs: 80, be: 5, fh: 50, fk: -10, bh: -35, bk: -25, y: 6, sway: -1 }),
          m(st, { x: 16, lean: 34, fs: 55, fe: 0, wpn: 5, bs: 50, be: 5, fh: 52, fk: -10, bh: -35, bk: -25, y: 7, sway: -0.8 }),
          m(st, { x: 8, lean: 12 }),
        ],
        guard: [m(st, { fs: 40, fe: 90, wpn: 90, bs: 45, be: 85, x: -2, eyes: "angry" }), m(st, { fs: 40, fe: 90, wpn: 90, bs: 45, be: 85, x: -3, eyes: "angry" })],
        cast: [m(st, { fs: 150, fe: 0, wpn: 30, glow: 0.5 }), m(st, { fs: 165, fe: 0, wpn: 15, glow: 1.2, shout: true }), m(st, { fs: 100, fe: 0, wpn: 0, glow: 1.5, x: 6 })],
        win: [m(st, { lean: 0, fs: 10, fe: 0, wpn: 175, bs: -5, be: 20, fh: 12, bh: -12, fk: 0, bk: 0, y: 0 }), m(st, { lean: 0, fs: 12, fe: 0, wpn: 175, bs: -5, be: 20, fh: 12, bh: -12, fk: 0, bk: 0, y: 0, sway: 0.5 })],
      };
    case "lance":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { x: -4, lean: -4, fs: 40, fe: 40, wpn: 0, bs: 30, be: 50, y: 3, eyes: "angry" }),
          m(st, { x: 12, lean: 24, fs: 85, fe: 5, wpn: 0, bs: 80, be: 10, fh: 50, fk: -10, bh: -38, bk: -20, y: 4, shout: true, sway: -1 }),
          m(st, { x: 20, lean: 28, fs: 92, fe: 0, wpn: 0, bs: 85, be: 5, fh: 52, fk: -8, bh: -40, bk: -20, y: 5, sway: -1, eyes: "angry" }),
          m(st, { x: 14, lean: 20, fs: 80, fe: 10, wpn: 0, y: 4 }),
          m(st, { x: 6 }),
        ],
        guard: [m(st, { fs: 100, fe: 50, wpn: -80, bs: 90, be: 40, x: -2, eyes: "angry" }), m(st, { fs: 100, fe: 50, wpn: -80, bs: 90, be: 40, x: -3 })],
        cast: [m(st, { fs: 160, fe: 0, wpn: 0, glow: 1 }), m(st, { fs: 165, fe: 0, wpn: 0, glow: 1.5, shout: true }), m(st, { fs: 110, fe: 0, wpn: 0, x: 6, glow: 1 })],
        win: [m(st, { lean: 0, fs: 10, fe: 10, wpn: 170, bs: 160, be: 10, fh: 8, bh: -8, fk: 0, bk: 0, y: 0 }), m(st, { lean: 0, fs: 10, fe: 10, wpn: 170, bs: 165, be: 10, fh: 8, bh: -8, fk: 0, bk: 0, y: 0, sway: 1 })],
      };
    case "fist":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { x: 6, lean: 18, fs: 92, fe: 0, bs: 40, be: 110, y: 4, shout: true, eyes: "angry" }),
          m(st, { x: 8, lean: 14, fs: 50, fe: 110, bs: 95, be: 0, y: 4, eyes: "angry" }),
          m(st, { x: 12, lean: 4, fs: 160, fe: 10, bs: 40, be: 100, fh: 30, fk: -5, bh: -40, bk: -30, y: -4, shout: true, eyes: "angry", sway: -1 }),
          m(st, { x: 14, lean: 10, fs: 130, fe: 30, bs: 30, be: 90, y: 0 }),
          m(st, { x: 6 }),
        ],
        guard: [m(st, { fs: 100, fe: 120, bs: 95, be: 125, lean: 4, x: -2, eyes: "angry" }), m(st, { fs: 100, fe: 120, bs: 95, be: 125, lean: 2, x: -3, eyes: "angry" })],
        cast: [m(st, { fs: 40, fe: 100, bs: 35, be: 100, lean: -4, glow: 1, eyes: "closed" }), m(st, { fs: 95, fe: 0, bs: 90, be: 0, x: 4, glow: 1.5, shout: true }), m(st, { fs: 95, fe: 0, bs: 90, be: 0, x: 6, glow: 1 })],
        win: [m(st, { lean: 0, fs: 165, fe: 10, bs: 20, be: 120, fh: 10, bh: -10, fk: 0, bk: 0, y: 0, shout: true }), m(st, { lean: 0, fs: 168, fe: 5, bs: 20, be: 120, fh: 10, bh: -10, fk: 0, bk: 0, y: -1 })],
      };
    case "mage":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { fs: 120, fe: 0, wpn: 60, glow: 0.5, eyes: "angry" }),
          m(st, { fs: 150, fe: 0, wpn: 30, glow: 1.2, lean: -4, shout: true }),
          m(st, { fs: 90, fe: 0, wpn: 0, glow: 1.8, lean: 12, x: 6, sway: -1, eyes: "angry" }),
          m(st, { fs: 80, fe: 0, wpn: 10, glow: 1, lean: 10, x: 6 }),
          m(st, { x: 2 }),
        ],
        guard: [m(st, { fs: 80, fe: 20, wpn: 100, bs: 85, be: 20, glow: 1, x: -2, eyes: "angry" }), m(st, { fs: 80, fe: 20, wpn: 100, bs: 85, be: 20, glow: 1.3, x: -3 })],
        cast: [m(st, { fs: 150, fe: 0, wpn: 30, bs: 140, be: 0, glow: 1, eyes: "closed" }), m(st, { fs: 160, fe: 0, wpn: 20, bs: 150, be: 0, glow: 2, eyes: "closed" }), m(st, { fs: 100, fe: 0, wpn: 0, bs: 95, be: 0, glow: 2, x: 4, shout: true })],
        win: [m(st, { fs: 168, fe: 0, wpn: 10, bs: 20, be: 30, glow: 2 }), m(st, { fs: 170, fe: 0, wpn: 8, bs: 20, be: 30, glow: 1.4, sway: 0.6 })],
      };
    case "twin":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { x: 10, lean: 30, fs: 130, fe: 20, wpn: 30, bs: 20, be: 30, fh: 55, fk: -30, bh: -50, bk: -30, y: 6, sway: -1, eyes: "angry" }),
          m(st, { x: 18, lean: 34, fs: 60, fe: 0, wpn: 20, bs: 120, be: 20, fh: 55, fk: -20, bh: -50, bk: -25, y: 7, sway: -1, shout: true }),
          m(st, { x: 20, lean: 30, fs: 120, fe: 30, wpn: 60, bs: 50, be: 0, fh: 50, fk: -20, bh: -45, bk: -25, y: 7, sway: -0.8 }),
          m(st, { x: 16, lean: 20, fs: 30, fe: 40, wpn: 80, bs: 30, be: 60, y: 5 }),
          m(st, { x: 8 }),
        ],
        guard: [m(st, { fs: 110, fe: 60, wpn: 100, bs: 100, be: 70, lean: 6, x: -2, eyes: "angry" }), m(st, { fs: 110, fe: 60, wpn: 100, bs: 100, be: 70, lean: 4, x: -4 })],
        cast: [m(st, { fs: 30, fe: 120, bs: 25, be: 110, glow: 1, eyes: "closed", lean: 2 }), m(st, { fs: 160, fe: 10, wpn: 10, bs: 150, be: 10, glow: 1.5 }), m(st, { fs: 95, fe: 0, wpn: 0, bs: 90, be: 0, glow: 1.5, x: 6, shout: true })],
        win: [m(st, { lean: 0, fs: 150, fe: 20, wpn: 20, bs: 10, be: 120, fh: 15, bh: -10, fk: 0, bk: 0, y: 0 }), m(st, { lean: 0, fs: 152, fe: 18, wpn: 22, bs: 10, be: 120, fh: 15, bh: -10, fk: 0, bk: 0, y: 0, sway: 1 })],
      };
  }
}

export const ANIM_FPS: Record<AnimName, number> = { idle: 5, attack: 14, hit: 10, guard: 8, cast: 8, ko: 8, win: 4, dash: 12 };
export const ANIM_LOOP: Record<AnimName, boolean> = { idle: true, attack: false, hit: false, guard: true, cast: false, ko: false, win: true, dash: true };

export const SHADOW = hex("#000000", 70);
