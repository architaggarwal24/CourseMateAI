/**
 * Pets: small pixel companions that idle beside the champion (arena, fight HUD, Hero header, previews).
 *
 * Three body plans over the same shaded-shape rasteriser as the champions - a small beast (cat, hound, fox,
 * panda, lion, unicorn), a bird (owl, phoenix) and a dragon (hatchling, elder) - each with a 4-frame idle:
 * breathing and a tail wag on the ground, a wing beat in the air. Every pet faces RIGHT, like the champion, and
 * stands on (or hovers over) `foot`. Ids are the shop's pet ids (backend/content/shop.json).
 */
import { PixelBuffer, type Pt } from "./buffer";
import { farSide, hex, ramp, type Material } from "./color";
import { add, dirOf } from "./rig";

export const PET_FRAME = { w: 64, h: 56, anchor: [30, 53] as Pt };
export const PET_FRAMES = 4;
export const PET_FPS = 5;

type Ears = "point" | "flop" | "round";
type Tail = "thin" | "bush" | "tuft" | "stub" | "flow";

interface BeastSpec {
  plan: "beast";
  body: Material; belly: Material; dark: Material; eye: Material;
  ears: Ears; tail: Tail;
  /** Tail tip / mane / horn / collar extras. */
  tip?: Material; mane?: Material; horn?: Material; collar?: Material;
  /** Panda markings: dark ears, legs and eye patches. */
  patches?: boolean;
  /** Longer legs and neck (the unicorn). */
  tall?: boolean;
  size: number;
}
interface BirdSpec {
  plan: "bird";
  body: Material; face: Material; wing: Material; eye: Material; beak: Material;
  /** Owl ear tufts / a flame crest and long tail plumes (phoenix). */
  tufts?: boolean; plumes?: Material;
  size: number;
}
interface DragonSpec {
  plan: "dragon";
  body: Material; belly: Material; wing: Material; horn: Material; eye: Material;
  size: number;
}
type PetSpec = BeastSpec | BirdSpec | DragonSpec;

export interface PetDef { id: string; name: string; flies: boolean; spec: PetSpec }

const R = ramp;
const E = (h: string) => ramp(h, { emissive: true });

const SPECS: Record<string, { name: string; spec: PetSpec }> = {
  pet_cat_orange: { name: "Pyra", spec: { plan: "beast", body: R("#f97316"), belly: R("#fed7aa"), dark: R("#7c2d12"), eye: R("#22c55e"), ears: "point", tail: "thin", tip: E("#fde047"), size: 1 } },
  pet_dog_brown: { name: "Rex", spec: { plan: "beast", body: R("#a16207"), belly: R("#fde68a"), dark: R("#451a03"), eye: R("#1c1917"), ears: "flop", tail: "stub", collar: R("#facc15", { shiny: true }), size: 1.05 } },
  pet_owl: { name: "Athena", spec: { plan: "bird", body: R("#64748b"), face: R("#f1f5f9"), wing: R("#475569"), eye: E("#fbbf24"), beak: R("#f59e0b"), tufts: true, size: 1.2 } },
  pet_panda: { name: "Kai", spec: { plan: "beast", body: R("#f5f5f4", { contrast: 1.2 }), belly: R("#e7e5e4", { contrast: 1.2 }), dark: R("#27272a"), eye: R("#0a0a0a"), ears: "round", tail: "stub", patches: true, size: 1.12 } },
  pet_fox: { name: "Zephyr", spec: { plan: "beast", body: R("#7c3aed"), belly: R("#ede9fe"), dark: R("#2e1065"), eye: E("#67e8f9"), ears: "point", tail: "bush", tip: R("#f5f3ff", { contrast: 1.3 }), size: 1 } },
  pet_unicorn: { name: "Lumis", spec: { plan: "beast", body: R("#f8fafc", { contrast: 1.2 }), belly: R("#e0e7ff", { contrast: 1.2 }), dark: R("#a5b4fc"), eye: R("#4c1d95"), ears: "point", tail: "flow", mane: R("#f0abfc"), horn: R("#fde047", { shiny: true }), tall: true, size: 1.05 } },
  pet_dragon_baby: { name: "Ignis", spec: { plan: "dragon", body: R("#dc2626"), belly: R("#fdba74"), wing: R("#f97316"), horn: R("#fef3c7"), eye: E("#fde047"), size: 0.9 } },
  pet_phoenix: { name: "Solara", spec: { plan: "bird", body: E("#f97316"), face: E("#fde047"), wing: E("#ef4444"), eye: E("#fffbeb"), beak: R("#facc15"), plumes: E("#facc15"), size: 0.95 } },
  pet_lion_golden: { name: "Aurum", spec: { plan: "beast", body: R("#eab308"), belly: R("#fef08a"), dark: R("#713f12"), eye: R("#78350f"), ears: "round", tail: "tuft", mane: R("#c2410c"), tip: R("#9a3412"), size: 1.15 } },
  pet_dragon_ancient: { name: "Erebus", spec: { plan: "dragon", body: R("#3b0764"), belly: R("#7e22ce"), wing: R("#1e1b4b"), horn: R("#d6d3d1", { shiny: true }), eye: E("#f43f5e"), size: 1.25 } },
};

export const PETS: Record<string, PetDef> = Object.fromEntries(
  Object.entries(SPECS).map(([id, { name, spec }]) => [id, { id, name, flies: spec.plan !== "beast", spec }]),
);

export const petById = (id: string | null | undefined): PetDef | undefined => (id ? PETS[id] : undefined);

// ── painters ──────────────────────────────────────────────────────────────────

function eyeDot(b: PixelBuffer, x: number, y: number, m: Material, big = false) {
  x = Math.round(x); y = Math.round(y);
  b.set(x, y, m.ramp[big ? 3 : 2]); b.set(x, y + 1, m.ramp[1]);
  if (big) { b.set(x + 1, y, m.ramp[4]); b.set(x + 1, y + 1, m.ramp[2]); }
}

function paintBeast(b: PixelBuffer, foot: Pt, sp: BeastSpec, f: number) {
  const s = sp.size, t = f / PET_FRAMES;
  const bob = [0, 0.5, 1, 0.5][f];
  const leg = (sp.tall ? 8 : sp.patches ? 3.5 : 5) * s;
  const rx = (sp.patches ? 8.5 : 8) * s, ry = (sp.patches ? 6 : 5) * s;
  const bx = foot[0] - 2 * s, by = foot[1] - leg - ry * 0.75 + bob * 0.5;
  const wag = Math.sin(t * Math.PI * 2);
  const legM = sp.patches ? sp.dark : sp.body;

  // far legs
  for (const lx of [bx - rx * 0.55, bx + rx * 0.55]) b.capsule(lx + 1, by + ry * 0.3, lx + 1.5, foot[1] - 1, 1.8 * s, 1.5 * s, farSide(legM));

  // tail behind the body
  const tb: Pt = [bx - rx * 0.85, by - ry * 0.25];
  const tm = sp.mane && sp.tail === "flow" ? sp.mane : sp.body;
  if (sp.tail === "thin" || sp.tail === "tuft" || sp.tail === "flow") {
    let p = tb;
    const n = sp.tail === "flow" ? 5 : 4;
    for (let i = 0; i < n; i++) {
      const ang = (sp.tail === "flow" ? 235 : 200) - i * (sp.tail === "flow" ? 8 : 18) + wag * 10;
      const q = add(p, dirOf(ang), 2.6 * s);
      b.capsule(p[0], p[1], q[0], q[1], (sp.tail === "flow" ? 2 : 1.2) * s, (sp.tail === "flow" ? 1.6 : 1.0) * s, i === n - 1 && sp.tip ? sp.tip : tm);
      p = q;
    }
    if (sp.tail === "tuft" && sp.tip) b.ellipse(p[0], p[1], 2 * s, 2 * s, sp.tip);
  } else if (sp.tail === "bush") {
    const mid = add(tb, dirOf(215 + wag * 8), 5 * s), end = add(mid, dirOf(175 + wag * 12), 5 * s);
    b.capsule(tb[0], tb[1], mid[0], mid[1], 2.2 * s, 3.4 * s, sp.body);
    b.capsule(mid[0], mid[1], end[0], end[1], 3.4 * s, 2 * s, sp.body);
    if (sp.tip) b.ellipse(end[0], end[1], 2.2 * s, 2.2 * s, sp.tip);
  } else {
    const q = add(tb, dirOf(200 + wag * 15), 2.4 * s);
    b.capsule(tb[0], tb[1], q[0], q[1], 1.6 * s, 1.3 * s, sp.patches ? sp.body : sp.body);
  }

  // body, belly, near legs
  b.ellipse(bx, by, rx, ry, sp.body);
  if (sp.patches) b.ellipse(bx + rx * 0.45, by - ry * 0.05, rx * 0.32, ry * 1.1, sp.dark, { clip: true }, 0.25);   // a panda's black shoulder band
  else b.ellipse(bx + rx * 0.15, by + ry * 0.55, rx * 0.65, ry * 0.45, sp.belly, { clip: true });
  for (const lx of [bx - rx * 0.6, bx + rx * 0.5]) b.capsule(lx, by + ry * 0.3, lx + 0.5, foot[1] - 1, 2 * s, 1.7 * s, legM);

  // neck + head
  const hx = bx + rx * 0.95, hy = by - ry * (sp.tall ? 1.35 : 0.85) - 1 * s + bob * 0.3;
  const hr = 4.3 * s;
  if (sp.tall) b.capsule(bx + rx * 0.55, by - ry * 0.2, hx - 0.5 * s, hy + 1 * s, 3.2 * s, 2.4 * s, sp.body);
  if (sp.mane && sp.tail !== "flow") {
    b.ellipse(hx - 1 * s, hy + 0.5 * s, hr * 1.55, hr * 1.5, sp.mane);
    for (let i = 0; i < 6; i++) {
      const a = 120 + i * 40, base = add([hx - 1 * s, hy + 0.5 * s], dirOf(a), hr * 1.3);
      b.ellipse(base[0], base[1], 1.8 * s, 1.8 * s, sp.mane);
    }
  }
  // ears (behind the head)
  const earF = (dx: number, m: Material) => {
    if (sp.ears === "point") b.poly([[hx + dx - 2.2 * s, hy - 2.2 * s], [hx + dx - 0.6 * s, hy - 7.6 * s], [hx + dx + 1.6 * s, hy - 2.8 * s]], m);
    else if (sp.ears === "round") b.ellipse(hx + dx, hy - 3.6 * s, (sp.patches ? 2.3 : 1.9) * s, (sp.patches ? 2.2 : 1.9) * s, m);
  };
  earF(-2.4 * s, farSide(sp.patches ? sp.dark : sp.body));
  b.ellipse(hx, hy, hr, hr * 0.92, sp.body);
  if (sp.mane && sp.tail === "flow") {
    // a unicorn's mane falls down the back of the neck
    for (let i = 0; i < 4; i++) b.capsule(hx - 2.5 * s - i * 1.2 * s, hy - 2.5 * s + i * 2.2 * s, hx - 5 * s - i * 1.4 * s - wag * 0.6 * s, hy + i * 2.4 * s, 1.9 * s, 1.2 * s, sp.mane);
  }
  earF(0.6 * s, sp.patches ? sp.dark : sp.body);
  if (sp.ears === "flop") b.capsule(hx - 1.6 * s, hy - 2.6 * s, hx - 3.4 * s, hy + 2.4 * s, 1.8 * s, 1.5 * s, sp.dark);
  // snout, nose, eye
  b.ellipse(hx + hr * 0.75, hy + 1.3 * s, 2.5 * s, 1.9 * s, sp.patches ? sp.body : sp.belly);
  b.set(Math.round(hx + hr * 0.75 + 2.2 * s), Math.round(hy + 0.5 * s), sp.dark.ramp[0]);
  if (sp.patches) b.ellipse(hx + 1.2 * s, hy - 0.4 * s, 2.1 * s, 1.8 * s, sp.dark, { clip: true }, -0.4);
  eyeDot(b, hx + 1.4 * s, hy - 0.8 * s, sp.patches ? R("#f5f5f4") : sp.eye);
  if (sp.horn) {
    const hb: Pt = [hx + 1 * s, hy - hr * 0.8], ht = add(hb, dirOf(150), 7 * s);
    b.capsule(hb[0], hb[1], ht[0], ht[1], 1.3 * s, 0.3 * s, sp.horn);
  }
  if (sp.collar) b.capsule(hx - 3 * s, hy + 2.8 * s, hx + 0.5 * s, hy + 3.8 * s, 1 * s, 1 * s, sp.collar);
}

function paintBird(b: PixelBuffer, foot: Pt, sp: BirdSpec, f: number) {
  const s = sp.size;
  const flap = [-1, 0, 1, 0][f];               // wings up, level, down, level
  const cx = foot[0], cy = foot[1] - 26 * s + [0, -1, -2, -1][f];
  const owl = !!sp.tufts;
  const bw = (owl ? 6 : 4.6) * s, bh = (owl ? 7 : 5.5) * s;

  // a wing is a long feathered oval hinged at the shoulder: up / level / down with the beat
  const wing = (m: Material, dx: number, dy: number) => {
    const len = (owl ? 7 : 9) * s;
    const ang = [210, 245, 290][flap + 1];   // rig angles: up-back, back, down-back
    const root: Pt = [cx - 1 * s + dx, cy - 2.5 * s + dy];
    const mid = add(root, dirOf(ang), len * 0.5);
    b.ellipse(mid[0], mid[1], len * 0.55, (owl ? 2.6 : 2.2) * s, m, {}, Math.atan2(dirOf(ang)[1], dirOf(ang)[0]));
    // flight feathers at the tip
    const tip = add(root, dirOf(ang), len);
    for (let i = -1; i <= 1; i++) b.capsule(mid[0], mid[1], ...add(tip, dirOf(ang + 90), i * 1.6 * s), 1.2 * s, 0.6 * s, m);
  };
  if (sp.plumes) {
    // long tail plumes trailing back and down
    for (let i = 0; i < 3; i++) {
      let p: Pt = [cx - bw * 0.6, cy + bh * 0.35];
      for (let j = 0; j < 4; j++) {
        const q = add(p, dirOf(-62 - i * 14 + j * 8 + flap * 4), 3.4 * s);
        b.capsule(p[0], p[1], q[0], q[1], (1.8 - j * 0.35) * s, (1.4 - j * 0.3) * s, j > 1 ? sp.plumes : sp.wing);
        p = q;
      }
    }
  }
  wing(farSide(sp.wing), 2.5 * s, -1 * s);
  // body + face
  b.ellipse(cx, cy, bw, bh, sp.body);
  if (owl) {
    b.ellipse(cx + 1.6 * s, cy - 2 * s, 4 * s, 3.4 * s, sp.face, { clip: true });
    b.ellipse(cx + 0.8 * s, cy + 3.2 * s, 3.4 * s, 3 * s, sp.face, { clip: true, bias: -0.2 });
    // ear tufts
    b.poly([[cx - 3 * s, cy - bh * 0.7], [cx - 4.2 * s, cy - bh - 3 * s], [cx - 0.8 * s, cy - bh * 0.85]], sp.body);
    b.poly([[cx + 1.5 * s, cy - bh * 0.8], [cx + 3.8 * s, cy - bh - 2.6 * s], [cx + 4 * s, cy - bh * 0.6]], sp.body);
    eyeDot(b, cx + 0.2 * s, cy - 2.4 * s, sp.eye, true);
    eyeDot(b, cx + 3 * s, cy - 2.4 * s, sp.eye, true);
    b.set(Math.round(cx + 1.8 * s), Math.round(cy - 0.5 * s), sp.beak.ramp[2]);
    b.set(Math.round(cx + 1.8 * s), Math.round(cy + 0.5 * s), sp.beak.ramp[1]);
  } else {
    // phoenix: a small head forward, a flame crest
    const hx = cx + bw * 0.85, hy = cy - bh * 0.85;
    b.ellipse(hx, hy, 3 * s, 2.8 * s, sp.face);
    for (let i = 0; i < 3; i++) {
      const base: Pt = [hx - 1 * s, hy - 2 * s], tip = add(base, dirOf(205 - i * 22 + flap * 6), (4.5 - i) * s);
      b.capsule(base[0], base[1], tip[0], tip[1], 1.2 * s, 0.3 * s, sp.plumes ?? sp.face);
    }
    b.poly([[hx + 2.4 * s, hy - 0.3 * s], [hx + 5 * s, hy + 0.6 * s], [hx + 2.4 * s, hy + 1.4 * s]], sp.beak);
    eyeDot(b, hx + 1 * s, hy - 0.8 * s, R("#1c1917"));
  }
  wing(sp.wing, -1 * s, 0);
  // talons tucked under
  for (const dx of [-1, 1.5]) { b.set(Math.round(cx + dx * s), Math.round(cy + bh), sp.beak.ramp[1]); b.set(Math.round(cx + dx * s), Math.round(cy + bh + 1), sp.beak.ramp[0]); }
}

function paintDragon(b: PixelBuffer, foot: Pt, sp: DragonSpec, f: number) {
  const s = sp.size;
  const flap = [-1, 0, 1, 0][f];
  const cx = foot[0] - 2 * s, cy = foot[1] - 22 * s + [0, -1, -2, -1][f];
  const wing = (m: Material, dx: number) => {
    const root: Pt = [cx + dx, cy - 3 * s];
    const tip = add(root, dirOf(205 - flap * 40), 14 * s);
    const mid = add(root, dirOf(240 - flap * 30), 9 * s);
    b.poly([root, tip, add(tip, dirOf(10), 4 * s), mid, [cx - 3 * s + dx, cy + 1 * s]], m);
    b.capsule(root[0], root[1], tip[0], tip[1], 1 * s, 0.5 * s, sp.body);
  };
  wing(farSide(sp.wing), 2 * s);
  // tail with a spade
  let p: Pt = [cx - 5 * s, cy + 2 * s];
  for (let i = 0; i < 4; i++) {
    const q = add(p, dirOf(235 - i * 22 + flap * 6), 3.2 * s);
    b.capsule(p[0], p[1], q[0], q[1], (2.4 - i * 0.45) * s, (2 - i * 0.45) * s, sp.body);
    p = q;
  }
  b.poly([add(p, [0, -2 * s]), add(p, [-3 * s, 0]), add(p, [0, 2 * s]), add(p, [1.5 * s, 0])], sp.wing);
  // hind and fore legs tucked under the body
  b.capsule(cx - 2 * s, cy + 3 * s, cx - 1 * s, cy + 7 * s, 1.8 * s, 1.3 * s, farSide(sp.body));
  b.ellipse(cx, cy, 7 * s, 4.8 * s, sp.body);
  b.ellipse(cx + 1 * s, cy + 2.4 * s, 4.6 * s, 2.4 * s, sp.belly, { clip: true });
  b.capsule(cx + 3 * s, cy + 3 * s, cx + 4.5 * s, cy + 6.5 * s, 1.6 * s, 1.2 * s, sp.body);
  // neck + head
  const hx = cx + 8 * s, hy = cy - 6 * s;
  b.capsule(cx + 4 * s, cy - 2 * s, hx - 1 * s, hy + 1 * s, 2.8 * s, 2.2 * s, sp.body);
  b.capsule(hx - 1.5 * s, hy - 2 * s, hx - 5 * s, hy - 6 * s, 1.3 * s, 0.3 * s, farSide(sp.horn));
  b.ellipse(hx, hy, 3.6 * s, 3.2 * s, sp.body);
  b.capsule(hx + 1 * s, hy + 0.8 * s, hx + 5.2 * s, hy + 1.4 * s, 2.2 * s, 1.6 * s, sp.body);
  b.capsule(hx, hy - 2.4 * s, hx - 3 * s, hy - 6.5 * s, 1.4 * s, 0.3 * s, sp.horn);
  eyeDot(b, hx + 1 * s, hy - 1 * s, sp.eye);
  b.set(Math.round(hx + 5 * s), Math.round(hy + 0.6 * s), sp.body.ramp[0]);
  wing(sp.wing, 0);
}

// ── frames ────────────────────────────────────────────────────────────────────

const OUTLINE = hex("#0b0a12");
const cache = new Map<string, PixelBuffer>();

/** One idle frame of a pet (cached), drawn in a PET_FRAME-sized buffer standing on PET_FRAME.anchor. */
export function petFrame(id: string, index: number): PixelBuffer | null {
  const pet = PETS[id];
  if (!pet) return null;
  const f = ((index % PET_FRAMES) + PET_FRAMES) % PET_FRAMES;
  const key = `${id}:${f}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const b = new PixelBuffer(PET_FRAME.w, PET_FRAME.h);
  const sp = pet.spec;
  if (sp.plan === "beast") paintBeast(b, PET_FRAME.anchor, sp, f);
  else if (sp.plan === "bird") paintBird(b, PET_FRAME.anchor, sp, f);
  else paintDragon(b, PET_FRAME.anchor, sp, f);
  b.outline(OUTLINE);
  cache.set(key, b);
  return b;
}

/** Where a pet stands relative to its champion's ground point: behind them, a little back (the champion faces right). */
export const PET_OFFSET: Pt = [-40, 2];
