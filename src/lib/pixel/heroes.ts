/**
 * The hero roster: six original fighters drawn with the humanoid rig, each with a fighting style that decides how
 * they stand, strike, guard, cast, fall and celebrate.
 */
import { hex, ramp, tint, type Material } from "./color";
import { HERO_BUILD, type HumanoidLook, type Pose } from "./rig";

export type AnimName = "idle" | "attack" | "hit" | "guard" | "cast" | "ko" | "win" | "dash" | "ride"
  // Stage 7: three idle fidgets per fighting style (played now and then while the fighter waits)
  | "fidget1" | "fidget2" | "fidget3";
export const FIDGETS = ["fidget1", "fidget2", "fidget3"] as const;
export type Style = "blade" | "heavy" | "lance" | "fist" | "mage" | "twin"
  // your hero's original styles (Apprentice Blade, Chain Whip, War Fan, Twin Kamas)
  | "sword" | "whip" | "fan" | "kamas";

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
  /** Set by skins.ts dressed() / appearance.ts: which loadout and look this wears (frame caches key on it). */
  skinKey?: string;
  /** The player built this look (appearance.ts): skins dress it by outfit style, not by champion. */
  custom?: boolean;
}

const skinLight = ramp("#f2c39c"), skinTan = ramp("#d99a6c"), skinDeep = ramp("#9c6040");

export const HEROES: HeroDef[] = [
  {
    id: "kaien", name: "Kaien", title: "Ronin of the Ninth Page", style: "blade", accent: "#5eead4",
    blurb: "A wandering swordsman. Fast, precise strikes.",
    look: {
      build: HERO_BUILD, scale: 1, skin: skinLight, eye: ramp("#38bdf8"),
      top: ramp("#1f2937"), topStyle: "coat", coat: ramp("#e5e7eb", { contrast: 1.2 }), coatLen: 20, sleeves: "long",
      pants: ramp("#334155"), boots: ramp("#1c1917"), belt: ramp("#dc2626"), trim: ramp("#334155"),
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
      gloves: ramp("#78350f"), trim: ramp("#d97706"),
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
      pants: ramp("#27272a"), baggy: true, boots: ramp("#57534e"), belt: ramp("#0a0a0a"), trim: ramp("#fbbf24"),
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
      pants: ramp("#1e1b4b"), boots: ramp("#1e1b4b"), belt: ramp("#facc15", { shiny: true }), trim: ramp("#facc15", { shiny: true }),
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
      pants: ramp("#1c1917"), boots: ramp("#292524"), gloves: ramp("#292524"), scarf: ramp("#e11d48"), trim: ramp("#e11d48"),
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
      cape: ramp("#1d4ed8"), trim: ramp("#fbbf24", { shiny: true }), pauldrons: ramp("#cbd5e1", { shiny: true }),
      hair: { style: "slick", mat: ramp("#fbbf24") },
      weapon: "greatsword", weaponMat: ramp("#e2e8f0", { shiny: true }), weaponAccent: ramp("#1e3a8a"), weaponGlow: ramp("#93c5fd", { emissive: true }),
    },
  },
];

export const DEFAULT_HERO = "kaien";
export const heroById = (id: string | null | undefined): HeroDef => HEROES.find((h) => h.id === id) ?? HEROES[0];
/** A fighter's display name and title: one of the six champions, or "hero" (your hero). */
export const fighterLabel = (id: string | null | undefined): { name: string; title: string } =>
  id === "hero" ? { name: "Your hero", title: "Built by you" } : { name: heroById(id).name, title: heroById(id).title };

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
  sword: { lean: 6, head: -3, fs: 35, fe: 60, wpn: 40, bs: 70, be: 70, fh: 24, fk: -20, bh: -16, bk: -10, y: 2 },
  whip: { lean: 4, head: -2, fs: 20, fe: 40, wpn: 20, bs: 30, be: 70, fh: 20, fk: -14, bh: -16, bk: -8, y: 1, lash: 0 },
  fan: { lean: 6, head: -4, fs: 60, fe: 50, wpn: 100, bs: 20, be: 90, fh: 18, fk: -12, bh: -14, bk: -8, y: 1 },
  kamas: { lean: 12, head: -6, fs: 45, fe: 70, wpn: 20, bs: 35, be: 80, fh: 28, fk: -26, bh: -20, bk: -12, y: 3 },
};

const m = (base: Pose, over: Pose): Pose => ({ ...base, ...over });

/** Every animation, smoothed: key poses with eased in-betweens and cloth that lags behind the body. Cached. */
const animCache = new Map<Style, Record<AnimName, Pose[]>>();
export function heroAnims(style: Style): Record<AnimName, Pose[]> {
  let a = animCache.get(style);
  if (!a) {
    const keys = heroKeys(style);
    a = { ...keys } as Record<AnimName, Pose[]>;
    for (const n of Object.keys(keys) as (keyof typeof keys)[]) if (n !== "idle") a[n] = inbetween(keys[n], ANIM_LOOP[n]);
    a.idle = breathe(STANCE[style]);
    // riding a mount: seated, thighs forward, shins down, a small bob with the mount's stride
    const st = STANCE[style];
    a.ride = inbetween([m(st, { lean: 4, head: -2, fh: 82, fk: -88, bh: 72, bk: -86, x: 0, y: 0, sway: 0.2 }), m(st, { lean: 6, head: -1, fh: 80, fk: -86, bh: 70, bk: -84, x: 0, y: -1, sway: 0.5 })], true);
    // the fidgets: from the stance, through their keys, back to the stance (so they slot into the idle loop)
    FIDGET_KEYS[style].forEach((f, i) => { a![FIDGETS[i]] = inbetween([st, ...f.keys.map((k) => m(st, k)), st], false); });
    animCache.set(style, a);
  }
  return a;
}

/** Key frames are drawn this many frames apart (one in-between each), so the frame rates below are doubled. */
export const SUB = 2;
/** The attack frame where the blow lands (key 2). */
export const HERO_IMPACT_FRAME = 2 * SUB;

const NUM: (keyof Pose)[] = ["x", "y", "lean", "head", "fs", "fe", "bs", "be", "fh", "fk", "bh", "bk", "wpn", "sway", "glow", "fall", "lash"];
const DEF: Partial<Record<keyof Pose, number>> = { fs: 10, fe: 12, bs: -6, be: 14, fh: 8, fk: -4, bh: -8, bk: -6 };
const val = (p: Pose, k: keyof Pose) => (p[k] as number | undefined) ?? DEF[k] ?? 0;

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = { ...(t < 0.5 ? a : b) };
  for (const k of NUM) {
    if (a[k] === undefined && b[k] === undefined) continue;
    (out as Record<string, unknown>)[k] = val(a, k) + (val(b, k) - val(a, k)) * t;
  }
  // follow-through: hair, cape and coat tails trail the move - they keep the old sway and get pushed back
  const push = -(val(b, "x") - val(a, "x")) * 0.06 - (val(b, "lean") - val(a, "lean")) * 0.025;
  out.sway = Math.max(-1, Math.min(1, val(a, "sway") + (val(b, "sway") - val(a, "sway")) * t * 0.5 + push));
  out.eyes = b.eyes ?? a.eyes;
  return out;
}

function inbetween(keys: Pose[], loop: boolean): Pose[] {
  const out: Pose[] = [];
  const n = keys.length;
  for (let i = 0; i < n; i++) {
    out.push(keys[i]);
    if (i < n - 1 || (loop && n > 1)) {
      const next = keys[(i + 1) % n];
      for (let j = 1; j < SUB; j++) out.push(lerpPose(keys[i], next, j / SUB));
    }
  }
  return out;
}

/** Idle: eight frames of breathing on a sine, the arms and the cloth a beat behind the chest. */
function breathe(st: Pose): Pose[] {
  return Array.from({ length: 8 }, (_, i) => {
    const p = (i / 8) * Math.PI * 2;
    const rise = (1 - Math.cos(p)) / 2;                 // 0 -> 1 -> 0
    const lag = (1 - Math.cos(p - 0.9)) / 2;
    return m(st, {
      y: (st.y ?? 0) + rise * 1.8,
      lean: (st.lean ?? 0) + rise * 1.2,
      head: (st.head ?? 0) + lag * 2,
      fs: (st.fs ?? 0) + lag * 3,
      bs: (st.bs ?? 0) - lag * 2,
      fe: (st.fe ?? 0) + rise * 2,
      wpn: st.wpn === undefined ? undefined : st.wpn - lag * 3,
      sway: 0.15 + Math.sin(p - 1.4) * 0.35,
    });
  });
}

/**
 * Stage 7: each fighting style's three idle fidgets, as key poses over its stance (named for the docs and tests).
 * A champion fidgets in their style; your hero in the style you built.
 */
export const FIDGET_KEYS: Record<Style, { name: string; keys: Pose[] }[]> = {
  blade: [
    { name: "Edge check", keys: [{ head: 10, fe: 95, wpn: 70 }, { head: 12, fe: 100, wpn: 82, eyes: "closed" }, { head: 6, fe: 90, wpn: 62 }] },
    { name: "Shoulder roll", keys: [{ bs: 75, be: 40, lean: 2, sway: 0.4 }, { bs: 20, be: 95, lean: 11, sway: -0.3 }, { bs: 55, be: 55 }] },
    { name: "Stance shift", keys: [{ fh: 10, fk: -8, bh: -8, x: -2, y: 0 }, { fh: 32, fk: -28, x: 1, y: 3, sway: 0.5 }] },
  ],
  heavy: [
    { name: "Shoulder the blade", keys: [{ fs: 15, fe: 105, wpn: 120 }, { fs: 8, fe: 112, wpn: 132, head: -6, y: 1 }, { fs: 12, fe: 108, wpn: 126 }] },
    { name: "Neck crack", keys: [{ head: -16 }, { head: 14, eyes: "closed" }, { head: -6 }] },
    { name: "Stomp", keys: [{ fh: 44, fk: -54, y: 0, lean: 0 }, { fh: 22, fk: -18, y: 5, sway: 0.8 }] },
  ],
  lance: [
    { name: "Spear twirl", keys: [{ wpn: 110 }, { wpn: 200 }, { wpn: 290 }, { wpn: 382 }] },
    { name: "Plant the spear", keys: [{ fs: 20, fe: 10, wpn: 78, lean: 0 }, { fs: 20, fe: 10, wpn: 84, lean: -2, head: 5, eyes: "closed" }] },
    { name: "Scan the horizon", keys: [{ head: -14, lean: 2, bs: 100, be: 120 }, { head: -10, lean: 0, bs: 105, be: 125 }] },
  ],
  fist: [
    { name: "Knuckle crack", keys: [{ fs: 60, fe: 122, bs: 55, be: 122 }, { fs: 66, fe: 128, bs: 62, be: 128, head: 6, eyes: "closed" }] },
    { name: "Shadow jab", keys: [{ fs: 86, fe: 5, x: 2 }, { fs: 40, fe: 85 }, { fs: 86, fe: 5, x: 2, eyes: "angry" }] },
    { name: "Bounce", keys: [{ y: 0, fk: -10, bk: -6 }, { y: 6 }, { y: 0, fk: -10, bk: -6 }, { y: 5 }] },
  ],
  mage: [
    { name: "Glow flare", keys: [{ glow: 0.8, fe: 75 }, { glow: 1.2, fe: 82, eyes: "closed" }, { glow: 0.5 }] },
    { name: "Stretch", keys: [{ bs: 125, be: 20, lean: -4, head: -10 }, { bs: 135, be: 10, lean: -6, head: -12, eyes: "closed" }] },
    { name: "Staff tap", keys: [{ wpn: 80, y: -1 }, { wpn: 96, y: 1 }, { wpn: 80, y: -1 }] },
  ],
  twin: [
    { name: "Dagger spin", keys: [{ wpn: 130 }, { wpn: 250 }, { wpn: 370 }] },
    { name: "Crouch low", keys: [{ y: 9, fk: -55, bk: -34, lean: 22 }, { y: 10, fk: -58, bk: -36, lean: 24, head: -12 }] },
    { name: "Look back", keys: [{ head: 22, lean: 6 }, { head: 18, lean: 4, eyes: "angry" }] },
  ],
  sword: [
    { name: "Practice swing", keys: [{ fs: 85, fe: 30, wpn: 60 }, { fs: 10, fe: 60, wpn: 20 }] },
    { name: "Wipe the blade", keys: [{ bs: 50, be: 100, fe: 92, wpn: 82, head: 8 }, { bs: 60, be: 95, fe: 88, wpn: 76, head: 9 }] },
    { name: "Deep breath", keys: [{ lean: -2, head: -8, eyes: "closed", y: 0 }, { lean: -3, head: -9, eyes: "closed", y: -1 }] },
  ],
  whip: [
    { name: "Lash crack", keys: [{ lash: 0.8, fs: 72, fe: 20 }, { lash: 1, fs: 92, fe: 10 }, { lash: 0.2, fs: 20 }] },
    { name: "Coil the chain", keys: [{ fs: 40, fe: 100, lash: 0 }, { fs: 46, fe: 112 }, { fs: 40, fe: 100 }] },
    { name: "Shrug", keys: [{ bs: 52, fs: 36, head: 4 }, { bs: 30, fs: 20 }] },
  ],
  fan: [
    { name: "Fan flourish", keys: [{ wpn: 160, fs: 82 }, { wpn: 60, fs: 70 }] },
    { name: "Fan the face", keys: [{ fs: 82, fe: 120, wpn: 140 }, { fs: 86, fe: 126, wpn: 118 }, { fs: 82, fe: 120, wpn: 140 }] },
    { name: "Twirl step", keys: [{ x: 2, sway: 0.8 }, { x: -1, sway: -0.6 }] },
  ],
  kamas: [
    { name: "Sickle spin", keys: [{ wpn: 140 }, { wpn: 280 }, { wpn: 380 }] },
    { name: "Sharpen", keys: [{ bs: 50, be: 92, fs: 40, fe: 102, wpn: 90 }, { bs: 56, be: 86, fs: 42, fe: 98, wpn: 96 }] },
    { name: "Hunched glare", keys: [{ lean: 22, head: -12, eyes: "angry" }, { lean: 24, head: -14, eyes: "angry" }] },
  ],
};

function heroKeys(style: Style): Record<Exclude<AnimName, "ride" | (typeof FIDGETS)[number]>, Pose[]> {
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
    case "sword":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { lean: -4, fs: 140, fe: 40, wpn: 10, bs: 90, be: 60, y: 3, eyes: "angry" }),
          m(st, { x: 10, lean: 20, fs: 100, fe: 10, wpn: 0, bs: 80, be: 60, fh: 46, fk: -12, bh: -36, bk: -20, y: 4, sway: -1, shout: true, eyes: "angry" }),
          m(st, { x: 16, lean: 26, fs: 92, fe: 0, wpn: 0, bs: 60, be: 70, fh: 50, fk: -10, bh: -40, bk: -20, y: 5, sway: -1, eyes: "angry" }),
          m(st, { x: 14, lean: 18, fs: 40, fe: 20, wpn: 30, bs: 70, be: 70, fh: 44, fk: -12, bh: -34, bk: -18, y: 4 }),
          m(st, { x: 6 }),
        ],
        guard: [m(st, { fs: 30, fe: 80, wpn: 60, bs: 95, be: 40, lean: 2, x: -2, eyes: "angry" }), m(st, { fs: 30, fe: 80, wpn: 60, bs: 95, be: 40, lean: 0, x: -3, eyes: "angry" })],
        cast: [m(st, { fs: 150, fe: 10, wpn: 10, glow: 0.6, eyes: "closed" }), m(st, { fs: 165, fe: 0, wpn: 0, glow: 1.4 }), m(st, { fs: 100, fe: 0, wpn: 0, glow: 1.6, x: 5, shout: true })],
        win: [m(st, { lean: 0, fs: 160, fe: 10, wpn: 0, bs: 60, be: 60, fh: 10, bh: -10, fk: 0, bk: 0, y: 0 }), m(st, { lean: 0, fs: 162, fe: 8, wpn: 0, bs: 60, be: 60, fh: 10, bh: -10, fk: 0, bk: 0, y: 0, sway: 0.7 })],
      };
    case "whip":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { lean: -8, fs: 170, fe: 20, wpn: 10, y: 2, lash: 0.2, eyes: "angry" }),
          m(st, { x: 4, lean: 6, fs: 150, fe: 0, wpn: 0, y: 2, lash: 0.6, sway: -0.5, shout: true }),
          m(st, { x: 8, lean: 16, fs: 95, fe: 0, wpn: 0, fh: 34, fk: -10, bh: -26, y: 3, lash: 1, sway: -1, eyes: "angry" }),
          m(st, { x: 8, lean: 14, fs: 70, fe: 10, wpn: 0, y: 3, lash: 1, sway: 0.6 }),
          m(st, { x: 3, lash: 0.3 }),
        ],
        guard: [m(st, { fs: 110, fe: 60, wpn: 90, bs: 100, be: 60, x: -2, eyes: "angry", lash: 0.5 }), m(st, { fs: 110, fe: 60, wpn: 90, bs: 100, be: 60, x: -3, lash: 0.5, sway: 0.5 })],
        cast: [m(st, { fs: 170, fe: 0, wpn: 0, glow: 0.8, lash: 1, eyes: "closed" }), m(st, { fs: 175, fe: 0, wpn: 20, glow: 1.4, lash: 1, sway: 1 }), m(st, { fs: 95, fe: 0, wpn: 0, glow: 1.6, lash: 1, x: 5, shout: true })],
        win: [m(st, { lean: 0, fs: 175, fe: 0, wpn: 0, lash: 1, fh: 10, bh: -10, fk: 0, bk: 0, y: 0 }), m(st, { lean: 0, fs: 175, fe: 0, wpn: 30, lash: 1, fh: 10, bh: -10, fk: 0, bk: 0, y: 0, sway: 1 })],
      };
    case "fan":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { lean: -6, fs: 160, fe: 30, wpn: 120, bs: 40, be: 60, y: 2, eyes: "angry" }),
          m(st, { x: 8, lean: 14, fs: 120, fe: 10, wpn: 80, fh: 38, fk: -12, bh: -30, y: 3, sway: -1, shout: true }),
          m(st, { x: 14, lean: 22, fs: 70, fe: 0, wpn: 40, fh: 44, fk: -10, bh: -34, bk: -18, y: 4, sway: -1, eyes: "angry" }),
          m(st, { x: 12, lean: 16, fs: 30, fe: 30, wpn: 20, y: 3, sway: 0.5 }),
          m(st, { x: 5 }),
        ],
        guard: [m(st, { fs: 100, fe: 70, wpn: 180, bs: 40, be: 80, x: -2, eyes: "angry" }), m(st, { fs: 100, fe: 70, wpn: 180, bs: 40, be: 80, x: -3 })],
        cast: [m(st, { fs: 150, fe: 0, wpn: 90, bs: 140, be: 0, glow: 1, eyes: "closed" }), m(st, { fs: 165, fe: 0, wpn: 120, bs: 150, be: 0, glow: 1.6 }), m(st, { fs: 95, fe: 0, wpn: 90, bs: 90, be: 0, glow: 1.8, x: 4, shout: true })],
        win: [m(st, { lean: 0, fs: 165, fe: 10, wpn: 140, bs: 20, be: 120, fh: 12, bh: -12, fk: 0, bk: 0, y: 0 }), m(st, { lean: 0, fs: 168, fe: 6, wpn: 150, bs: 20, be: 120, fh: 12, bh: -12, fk: 0, bk: 0, y: 0, sway: 0.8 })],
      };
    case "kamas":
      return {
        idle, hit, ko, dash,
        attack: [
          m(st, { x: 8, lean: 26, fs: 140, fe: 30, wpn: 20, bs: 130, be: 30, fh: 50, fk: -30, bh: -44, bk: -28, y: 5, sway: -1, eyes: "angry" }),
          m(st, { x: 14, lean: 30, fs: 60, fe: 10, wpn: 10, bs: 140, be: 20, fh: 52, fk: -22, bh: -46, bk: -24, y: 6, sway: -1, shout: true }),
          m(st, { x: 18, lean: 28, fs: 130, fe: 40, wpn: 30, bs: 60, be: 10, fh: 50, fk: -20, bh: -44, bk: -24, y: 6, sway: -0.8 }),
          m(st, { x: 14, lean: 18, fs: 40, fe: 50, wpn: 40, bs: 40, be: 60, y: 4 }),
          m(st, { x: 6 }),
        ],
        guard: [m(st, { fs: 115, fe: 70, wpn: 70, bs: 105, be: 75, lean: 4, x: -2, eyes: "angry" }), m(st, { fs: 115, fe: 70, wpn: 70, bs: 105, be: 75, lean: 2, x: -4 })],
        cast: [m(st, { fs: 35, fe: 110, bs: 30, be: 100, glow: 1, eyes: "closed" }), m(st, { fs: 165, fe: 10, wpn: 10, bs: 155, be: 10, glow: 1.5 }), m(st, { fs: 95, fe: 0, wpn: 0, bs: 90, be: 0, glow: 1.6, x: 6, shout: true })],
        win: [m(st, { lean: 0, fs: 150, fe: 30, wpn: 30, bs: 150, be: 30, fh: 14, bh: -12, fk: 0, bk: 0, y: 0 }), m(st, { lean: 0, fs: 152, fe: 28, wpn: 32, bs: 152, be: 28, fh: 14, bh: -12, fk: 0, bk: 0, y: 0, sway: 1 })],
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

export const ANIM_FPS: Record<AnimName, number> = { idle: 10, attack: 28, hit: 20, guard: 16, cast: 16, ko: 16, win: 8, dash: 24, ride: 10, fidget1: 9, fidget2: 9, fidget3: 9 };
export const ANIM_LOOP: Record<AnimName, boolean> = { idle: true, attack: false, hit: false, guard: true, cast: false, ko: false, win: true, dash: true, ride: true, fidget1: false, fidget2: false, fidget3: false };

export const SHADOW = hex("#000000", 70);
