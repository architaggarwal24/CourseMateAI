/**
 * The bestiary's sprites: 13 mythic creatures, each a painter over the same shaded-shape rasteriser as the heroes.
 * Four body plans - giant humanoid (rig.ts), quadruped, serpent, and the one-offs (Simurgh, Kraken) - posed by a
 * handful of numbers (BossParams) so every creature gets idle / attack / hit / cast / ko frames.
 *
 * Every creature is drawn facing RIGHT standing on `foot`; the scene mirrors it to face the hero.
 * Ids match backend/core_brains/bestiary.py.
 */
import { PixelBuffer, type Pt } from "./buffer";
import { farSide, ramp, type Material } from "./color";
import { add, dirOf, drawHumanoid, lerpPt, type Build, type HumanoidLook, type Pose, type Skeleton } from "./rig";

export type BossAnim = "idle" | "attack" | "hit" | "cast" | "ko";

export interface BossParams {
  /** 0..1 around the idle loop (tails, tentacles, breathing). */
  t: number;
  /** Vertical breathing offset. */
  bob: number;
  /** -1 (wind up / pull back) .. 1 (full lunge / strike). */
  reach: number;
  /** 0..1 knocked back. */
  recoil: number;
  /** 0..1 jaw open. */
  mouth: number;
  /** 0..2 magic glow (cast, rage). */
  glow: number;
  /** KO: rotation (deg) and sink (px). */
  fall: number;
  sink: number;
}

export interface BossDef {
  id: string;
  name: string;
  origin: string;
  /** Background stage the fight uses (see stages.ts). */
  stage: string;
  /** The creature's signature colour (UI accents, hit sparks). */
  accent: string;
  paint: (b: PixelBuffer, foot: Pt, p: BossParams) => void;
}

export const BOSS_FRAME = { w: 280, h: 262, anchor: [150, 254] as Pt };

const P0: BossParams = { t: 0, bob: 0, reach: 0, recoil: 0, mouth: 0, glow: 0, fall: 0, sink: 0 };
const P = (o: Partial<BossParams>): BossParams => ({ ...P0, ...o });

export const BOSS_ANIMS: Record<BossAnim, BossParams[]> = {
  idle: [0, 1, 2, 3].map((i) => P({ t: i / 4, bob: [0, 1, 2, 1][i] })),
  attack: [P({ reach: -0.7, mouth: 0.3, t: 0.1 }), P({ reach: 0.4, mouth: 1, t: 0.2 }), P({ reach: 1, mouth: 1, t: 0.3 }), P({ reach: 0.6, mouth: 0.4, t: 0.4 }), P({ t: 0.5, bob: 1 })],
  hit: [P({ recoil: 1, mouth: 0.7, t: 0.6 }), P({ recoil: 0.45, mouth: 0.3, t: 0.7 })],
  cast: [P({ glow: 0.6, mouth: 0.4, reach: -0.3 }), P({ glow: 1.4, mouth: 1, reach: -0.4, t: 0.3 }), P({ glow: 2, mouth: 1, reach: 0.2, t: 0.5 })],
  // KO: staggers and sags; the scene finishes it (flash, then the sprite crumbles into pixels).
  ko: [P({ recoil: 1, mouth: 1 }), P({ recoil: 1, mouth: 1, fall: -6, sink: 3 }), P({ recoil: 1, mouth: 0.6, fall: -11, sink: 7 }), P({ recoil: 1, mouth: 0.3, fall: -15, sink: 11 })],
};
export const BOSS_FPS: Record<BossAnim, number> = { idle: 4, attack: 10, hit: 9, cast: 7, ko: 6 };

// ── helpers ───────────────────────────────────────────────────────────────────
const W = (h: string, o?: Parameters<typeof ramp>[1]) => ramp(h, o);
const TEETH = W("#f5f5f4", { contrast: 0.6 });
const sin = (x: number) => Math.sin(x * Math.PI * 2);

/** A smooth tube through points [x, y, radius] (necks, tails, tentacles, serpent bodies). */
function tube(b: PixelBuffer, pts: [number, number, number][], m: Material, belly?: Material) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0, r0] = pts[i], [x1, y1, r1] = pts[i + 1];
    b.capsule(x0, y0, x1, y1, r0, r1, m, { rim: i === 0, smooth: true });
  }
  if (belly) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0, r0] = pts[i], [x1, y1, r1] = pts[i + 1];
      // the belly stripe sits on the lower-front side of the tube
      const nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny) || 1;
      const ox = (nx / l), oy = (ny / l);
      const side = oy >= 0 ? 1 : -1;
      b.capsule(x0 + ox * r0 * 0.62 * side, y0 + oy * r0 * 0.62 * side, x1 + ox * r1 * 0.62 * side, y1 + oy * r1 * 0.62 * side, r0 * 0.38, r1 * 0.38, belly, { clip: true, rim: false, smooth: true, bias: -0.15 });
    }
  }
}

/** Points along a sine-wave from a to b. */
function wave(a: Pt, bpt: Pt, n: number, amp: number, phase: number, r0: number, r1: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const dx = bpt[0] - a[0], dy = bpt[1] - a[1], l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const w = Math.sin(u * Math.PI * 1.6 + phase) * amp * u;
    out.push([a[0] + dx * u + nx * w, a[1] + dy * u + ny * w, r0 + (r1 - r0) * u]);
  }
  return out;
}

function eye(b: PixelBuffer, x: number, y: number, r: number, m: Material, slit = false) {
  b.ellipse(x, y, r, r * 0.8, m, { rim: false });
  if (slit) b.line(x, y - r * 0.6, x, y + r * 0.6, m.ramp[0]);
  b.set(Math.floor(x + r * 0.3), Math.floor(y - r * 0.3), m.ramp[4]);
}

function fang(b: PixelBuffer, x: number, y: number, len: number, down = true) {
  b.poly([[x - 1.2, y], [x + 1.2, y], [x, y + (down ? len : -len)]], TEETH, { rim: false });
}

// ── giant humanoids (Minotaur, Cyclops, Oni, Rakshasa) ────────────────────────
const GIANT: Build = {
  headR: 6.2, neck: 1.5, torso: 21, upper: 12, fore: 11.5, thigh: 14, shin: 13, foot: 6,
  shoulderW: 22, waistW: 15, hipW: 16, armR: 4.6, foreR: 4.1, handR: 3.5, thighR: 5.6, shinR: 4.3,
};

function giantPose(p: BossParams, swing: "overhead" | "thrust" | "claw" | "throw"): Pose {
  const base: Pose = { lean: 10, head: -4, fs: 30, fe: 60, wpn: 70, bs: 30, be: 60, fh: 20, fk: -14, bh: -16, bk: -8, y: p.bob, sway: sin(p.t) * 0.4 };
  if (p.recoil > 0) return { ...base, lean: -12 * p.recoil, head: 18 * p.recoil, x: -6 * p.recoil, fs: 10, fe: 20, bs: -10, eyes: "hurt", shout: p.mouth > 0.3, sway: 1, fall: p.fall, y: p.sink };
  if (p.glow > 0) return { ...base, fs: 150, fe: 10, bs: 140, be: 10, wpn: 30, lean: -4, shout: p.mouth > 0.5, glow: p.glow, eyes: "angry" };
  if (p.reach !== 0) {
    const r = p.reach;
    if (swing === "overhead") return r < 0 ? { ...base, fs: 175, fe: 10, wpn: 20, bs: 160, be: 10, lean: -6, shout: true, eyes: "angry" }
      : { ...base, x: 14 * r, lean: 10 + 22 * r, fs: 175 - 110 * r, fe: 0, wpn: 5, bs: 160 - 100 * r, be: 0, fh: 20 + 25 * r, bh: -16 - 20 * r, shout: true, eyes: "angry", sway: -1, y: 3 * r };
    if (swing === "claw") return r < 0 ? { ...base, fs: 140, fe: 40, bs: 120, be: 60, lean: -8, shout: true, eyes: "angry" }
      : { ...base, x: 16 * r, lean: 12 + 20 * r, fs: 140 - 60 * r, fe: 20, bs: 100, be: 50, fh: 30 * r + 20, bh: -30 * r - 16, shout: true, eyes: "angry", sway: -1 };
    if (swing === "throw") return r < 0 ? { ...base, fs: -150, fe: 30, lean: -10, bs: 60, shout: true, eyes: "angry" }
      : { ...base, x: 10 * r, lean: 20 * r, fs: 100 - 40 * r, fe: 0, wpn: 0, shout: true, eyes: "angry", sway: -1 };
    return { ...base, x: 18 * r, lean: 25 * r, fs: 90, fe: 0, wpn: 0, eyes: "angry", shout: true };
  }
  return base;
}

function giant(look: Omit<HumanoidLook, "build" | "scale"> & { scale?: number }, swing: "overhead" | "thrust" | "claw" | "throw") {
  const full: HumanoidLook = { build: GIANT, scale: look.scale ?? 2.3, ...look };
  return (b: PixelBuffer, foot: Pt, p: BossParams) => drawHumanoid(b, full, giantPose(p, swing), foot);
}

/** Head painters reuse the hero head's place (k.headC) but draw a creature. */
function bullHead(fur: Material, horn: Material, eyeM: Material, ring: Material) {
  return (b: PixelBuffer, k: Skeleton, pose: Pose) => {
    const s = k.s, [cx, cy] = k.headC, r = 6.2 * s;
    // horns (behind and above)
    const hornL = add([cx - r * 0.3, cy - r * 0.6], dirOf(200), 0);
    tube(b, [[hornL[0], hornL[1], 2.6 * s], [cx - r * 1.1, cy - r * 1.0, 2.2 * s], [cx - r * 1.3, cy - r * 1.7, 1.4 * s], [cx - r * 0.9, cy - r * 2.2, 0.5 * s]], farSide(horn));
    b.capsule(k.neck[0], k.neck[1] + 2 * s, cx, cy, 5 * s, 4.5 * s, fur);
    b.ellipse(cx, cy, r * 0.95, r * 0.9, fur);
    // long muzzle
    const mo = pose.shout ? 2.2 * s : 0;
    b.poly([[cx + r * 0.2, cy - r * 0.35], [cx + r * 1.55, cy + r * 0.05], [cx + r * 1.6, cy + r * 0.75], [cx + r * 0.3, cy + r * 0.9]], fur);
    if (mo) b.poly([[cx + r * 0.5, cy + r * 0.8], [cx + r * 1.5, cy + r * 0.75 + mo], [cx + r * 0.4, cy + r * 1.0 + mo]], fur.ramp[0] ? fur : fur);
    b.ellipse(cx + r * 1.45, cy + r * 0.3, 1.2 * s, 1.0 * s, W("#3f1d0f"), { rim: false });
    b.ellipse(cx + r * 1.35, cy + r * 0.85, 2 * s, 1.6 * s, ring, { rim: false });
    b.ellipse(cx + r * 1.35, cy + r * 0.85, 1 * s, 0.8 * s, fur, { rim: false });
    tube(b, [[cx + r * 0.1, cy - r * 0.6, 2.6 * s], [cx + r * 0.7, cy - r * 1.1, 2.1 * s], [cx + r * 0.6, cy - r * 1.8, 1.3 * s], [cx + r * 0.15, cy - r * 2.25, 0.5 * s]], horn);
    eye(b, cx + r * 0.55, cy - r * 0.1, 1.5 * s, eyeM);
    // ear
    b.poly([[cx - r * 0.5, cy - r * 0.2], [cx - r * 1.3, cy - r * 0.1], [cx - r * 0.6, cy + r * 0.3]], fur);
  };
}

function cyclopsHead(skin: Material, eyeM: Material, horn: Material) {
  return (b: PixelBuffer, k: Skeleton, pose: Pose) => {
    const s = k.s, [cx, cy] = k.headC, r = 6.4 * s;
    b.capsule(k.neck[0], k.neck[1] + 2 * s, cx, cy, 5 * s, 4.5 * s, skin);
    b.ellipse(cx, cy, r * 1.0, r * 1.05, skin);
    b.poly([[cx - r * 0.2, cy + r * 0.2], [cx + r * 1.05, cy + r * 0.2], [cx + r * 0.8, cy + r * 1.05], [cx - r * 0.2, cy + r * 1.1]], skin, { rim: false });
    // the one great eye
    b.ellipse(cx + r * 0.45, cy - r * 0.15, r * 0.48, r * 0.4, W("#f8fafc", { contrast: 0.5 }), { rim: false });
    b.ellipse(cx + r * 0.6, cy - r * 0.15, r * 0.24, r * 0.3, eyeM, { rim: false });
    b.set(Math.floor(cx + r * 0.66), Math.floor(cy - r * 0.3), eyeM.ramp[4]);
    b.line(cx + r * 0.05, cy - r * 0.62, cx + r * 0.95, cy - r * 0.55, skin.ramp[0]);
    // horn nub and a tusked mouth
    b.poly([[cx - r * 0.1, cy - r * 0.9], [cx + r * 0.2, cy - r * 1.7], [cx + r * 0.4, cy - r * 0.85]], horn);
    const my = cy + r * 0.72;
    b.line(cx + r * 0.25, my, cx + r * 0.95, my - 1, skin.ramp[0]);
    if (pose.shout) b.poly([[cx + r * 0.25, my], [cx + r * 0.95, my - 1], [cx + r * 0.7, my + 3 * s]], W("#450a0a"), { rim: false });
    fang(b, cx + r * 0.85, my - 1, -2.4 * s, false);
    b.ellipse(cx - r * 0.55, cy + r * 0.1, 1.8 * s, 2.4 * s, skin, { bias: -0.1 });
  };
}

function oniHead(skin: Material, hair: Material, horn: Material, eyeM: Material) {
  return (b: PixelBuffer, k: Skeleton, pose: Pose) => {
    const s = k.s, [cx, cy] = k.headC, r = 6.3 * s, sw = pose.sway ?? 0;
    // wild mane behind
    for (let i = 0; i < 6; i++) {
      const a = 150 + i * 22;
      const base: Pt = [cx - r * 0.4, cy - r * 0.2];
      b.poly([add(base, dirOf(a + 90), r * 0.5), add(base, dirOf(a + sw * 6), r * (1.6 + (i % 2) * 0.4)), add(base, dirOf(a - 90), r * 0.5)], hair);
    }
    b.capsule(k.neck[0], k.neck[1] + 2 * s, cx, cy, 5 * s, 4.5 * s, skin);
    b.ellipse(cx, cy, r * 0.95, r * 1.0, skin);
    b.poly([[cx - r * 0.2, cy + r * 0.2], [cx + r * 1.05, cy + r * 0.15], [cx + r * 0.85, cy + r * 1.05], [cx, cy + r * 1.15]], skin, { rim: false });
    // horns
    tube(b, [[cx + r * 0.0, cy - r * 0.8, 2.4 * s], [cx + r * 0.1, cy - r * 1.5, 1.7 * s], [cx + r * 0.45, cy - r * 2.1, 0.5 * s]], horn);
    tube(b, [[cx - r * 0.6, cy - r * 0.7, 2.2 * s], [cx - r * 0.9, cy - r * 1.4, 1.5 * s], [cx - r * 0.75, cy - r * 2.0, 0.5 * s]], farSide(horn));
    // brow + glowing eyes
    b.poly([[cx + r * 0.05, cy - r * 0.45], [cx + r * 1.0, cy - r * 0.2], [cx + r * 0.95, cy - r * 0.05], [cx + r * 0.1, cy - r * 0.25]], hair, { rim: false });
    eye(b, cx + r * 0.6, cy + r * 0.05, 1.4 * s, eyeM);
    // grimace with tusks
    const my = cy + r * 0.7, open = pose.shout ? 2.6 * s : 0.8 * s;
    b.poly([[cx + r * 0.2, my - 1], [cx + r * 1.0, my - 2], [cx + r * 0.95, my + open], [cx + r * 0.25, my + open]], W("#450a0a"), { rim: false });
    fang(b, cx + r * 0.35, my + open, -3.2 * s, false);
    fang(b, cx + r * 0.9, my + open, -3 * s, false);
    b.line(cx + r * 0.3, my - 1, cx + r * 0.95, my - 2, TEETH.ramp[2]);
  };
}

function tigerHead(fur: Material, stripe: Material, eyeM: Material, crown: Material) {
  return (b: PixelBuffer, k: Skeleton, pose: Pose) => {
    const s = k.s, [cx, cy] = k.headC, r = 6.4 * s;
    b.capsule(k.neck[0], k.neck[1] + 2 * s, cx, cy, 5 * s, 4.6 * s, fur);
    // ruff
    b.ellipse(cx - r * 0.2, cy + r * 0.3, r * 1.25, r * 1.1, W("#fef3c7"));
    b.ellipse(cx, cy, r, r * 0.95, fur);
    // muzzle
    b.ellipse(cx + r * 0.9, cy + r * 0.45, r * 0.6, r * 0.45, W("#fef3c7"), { rim: false });
    b.ellipse(cx + r * 1.35, cy + r * 0.2, 1.4 * s, 1.1 * s, W("#3f1d2b"), { rim: false });
    if (pose.shout) {
      b.poly([[cx + r * 0.5, cy + r * 0.7], [cx + r * 1.4, cy + r * 0.65], [cx + r * 1.2, cy + r * 1.3], [cx + r * 0.55, cy + r * 1.2]], W("#7f1d1d"), { rim: false });
      fang(b, cx + r * 1.25, cy + r * 0.66, 2.6 * s); fang(b, cx + r * 0.7, cy + r * 1.2, -2.2 * s, false);
    }
    // stripes
    for (const [x0, y0, x1, y1] of [[-0.2, -0.9, 0.1, -0.4], [0.3, -0.95, 0.4, -0.5], [-0.7, -0.5, -0.3, -0.2], [-0.8, 0.2, -0.4, 0.3]]) {
      b.capsule(cx + r * x0, cy + r * y0, cx + r * x1, cy + r * y1, 1 * s, 0.4 * s, stripe, { clip: true, rim: false });
    }
    eye(b, cx + r * 0.55, cy - r * 0.1, 1.5 * s, eyeM, true);
    b.poly([[cx - r * 0.4, cy - r * 0.6], [cx - r * 0.75, cy - r * 1.4], [cx - r * 0.05, cy - r * 0.85]], fur);
    // a jeweled crown band
    b.poly([[cx - r * 0.6, cy - r * 0.75], [cx + r * 0.7, cy - r * 0.95], [cx + r * 0.75, cy - r * 1.35], [cx + r * 0.3, cy - r * 1.05], [cx, cy - r * 1.55], [cx - r * 0.3, cy - r * 1.05], [cx - r * 0.65, cy - r * 1.2]], crown);
    b.ellipse(cx, cy - r * 1.05, 1.2 * s, 1.2 * s, W("#22d3ee", { emissive: true }), { rim: false });
  };
}

// ── quadrupeds (Fenrir, Kitsune, Sphinx, Ammit) ───────────────────────────────
interface Quad {
  body: Material; belly?: Material; dark?: Material;
  bodyRx: number; bodyRy: number; legLen: number; legR: number; neckLen: number;
  head: (b: PixelBuffer, at: Pt, p: BossParams) => void;
  tail: (b: PixelBuffer, root: Pt, p: BossParams) => void;
  back?: (b: PixelBuffer, body: Pt, p: BossParams) => void;   // drawn behind the body (wings...)
  front?: (b: PixelBuffer, body: Pt, p: BossParams) => void;  // details over the body (mane, chains...)
  paw: Material;
}

function quadruped(q: Quad) {
  return (b: PixelBuffer, foot: Pt, p: BossParams) => {
    const lunge = Math.max(0, p.reach) * 18 - p.recoil * 10 + Math.min(0, p.reach) * 6;
    const crouch = Math.max(0, -p.reach) * 8 + p.sink;
    const cx = foot[0] - 10 + lunge, cy = foot[1] - q.legLen - q.bodyRy * 0.55 + p.bob + crouch;
    const sw = sin(p.t);
    const legs: [number, number, boolean][] = [[-q.bodyRx * 0.6, -1, true], [q.bodyRx * 0.55, 1, true], [-q.bodyRx * 0.75, 1, false], [q.bodyRx * 0.7, -1, false]];
    q.back?.(b, [cx, cy], p);
    q.tail(b, [cx - q.bodyRx * 0.9, cy - q.bodyRy * 0.3], p);
    const leg = (dx: number, phase: number, far: boolean) => {
      const m = far ? farSide(q.body) : q.body;
      const hind = dx < 0;
      const top: Pt = [cx + dx, cy + q.bodyRy * 0.2];
      const stride = (p.reach > 0 ? (hind ? -8 : 12) * p.reach : 0) + phase * sw * 1.5;
      const pawP: Pt = [top[0] + stride + (hind ? -2 : 4), foot[1] - 3 + (far ? -2 : 0)];
      const r = q.legR;
      if (hind) {
        // big haunch, then the backward hock
        const knee: Pt = [top[0] + 8 + stride * 0.4, top[1] + q.legLen * 0.42 - crouch * 0.4];
        const hock: Pt = [pawP[0] - 7, pawP[1] - q.legLen * 0.3];
        b.ellipse(top[0] + 2, top[1] + 2, r * 2.4, r * 2.8, m, {}, 0.3);
        b.capsule(...knee, ...hock, r * 1.2, r * 0.8, m, { smooth: true });
        b.capsule(...hock, ...pawP, r * 0.8, r * 0.75, m, { smooth: true });
      } else {
        const elbow: Pt = [top[0] - 3 + stride * 0.3, top[1] + q.legLen * 0.48 - crouch * 0.5];
        b.capsule(...top, ...elbow, r * 2, r * 1.3, m, { smooth: true });
        b.capsule(...elbow, ...pawP, r * 1.2, r * 0.9, m, { smooth: true });
      }
      const pm = far ? farSide(q.paw) : q.paw;
      b.ellipse(pawP[0] + r * 0.5, pawP[1] + 0.5, r * 1.5, r * 0.9, pm);
      for (let c = 0; c < 3; c++) b.capsule(pawP[0] + r * (1.2 + c * 0.2), pawP[1] - 1 + c * 1.2, pawP[0] + r * 2.2 + c, pawP[1] + 1 + c * 1.2, 1.2, 0.4, TEETH, { rim: false });
    };
    for (const [dx, ph, far] of legs) if (far) leg(dx, ph, far);
    b.ellipse(cx, cy, q.bodyRx, q.bodyRy, q.body);
    if (q.belly) b.ellipse(cx + 4, cy + q.bodyRy * 0.55, q.bodyRx * 0.75, q.bodyRy * 0.4, q.belly, { clip: true, rim: false });
    for (const [dx, ph, far] of legs) if (!far) leg(dx, ph, far);
    const neckBase: Pt = [cx + q.bodyRx * 0.75, cy - q.bodyRy * 0.35];
    const headAt: Pt = [neckBase[0] + q.neckLen * 0.6 + Math.max(0, p.reach) * 8 - p.recoil * 6, neckBase[1] - q.neckLen + p.recoil * 6 - Math.max(0, p.reach) * -6];
    b.capsule(neckBase[0], neckBase[1], headAt[0], headAt[1], q.bodyRy * 0.6, q.bodyRy * 0.45, q.body);
    q.front?.(b, [cx, cy], p);
    q.head(b, headAt, p);
  };
}

function wolfHead(fur: Material, eyeM: Material, s = 1) {
  return (b: PixelBuffer, [x, y]: Pt, p: BossParams) => {
    const open = p.mouth * 7 * s;
    b.ellipse(x, y, 13 * s, 11 * s, fur);
    // ears
    b.poly([[x - 9 * s, y - 6 * s], [x - 7 * s, y - 22 * s], [x + 1 * s, y - 9 * s]], fur);
    b.poly([[x - 2 * s, y - 8 * s], [x + 3 * s, y - 23 * s], [x + 8 * s, y - 7 * s]], fur);
    // snout + jaw
    b.poly([[x + 4 * s, y - 6 * s], [x + 26 * s, y - 1 * s], [x + 27 * s, y + 4 * s], [x + 6 * s, y + 6 * s]], fur);
    b.poly([[x + 4 * s, y + 5 * s], [x + 24 * s, y + 4 * s + open], [x + 22 * s, y + 8 * s + open], [x + 2 * s, y + 10 * s]], farSide(fur));
    if (open > 1) {
      b.poly([[x + 6 * s, y + 5 * s], [x + 25 * s, y + 4 * s], [x + 23 * s, y + 4.5 * s + open]], W("#7f1d1d"), { rim: false });
      for (let i = 0; i < 4; i++) { fang(b, x + (10 + i * 4) * s, y + 4 * s, 2.6 * s); fang(b, x + (9 + i * 4) * s, y + 4 * s + open, -2.2 * s, false); }
    }
    b.ellipse(x + 26 * s, y - 0.5 * s, 2.2 * s, 1.8 * s, W("#111827"), { rim: false });
    eye(b, x + 6 * s, y - 4 * s, 2.4 * s, eyeM);
    b.line(x + 2 * s, y - 7 * s, x + 10 * s, y - 5.5 * s, fur.ramp[0]);
  };
}

function bushyTail(fur: Material, tip: Material | null, len: number, r: number) {
  return (b: PixelBuffer, root: Pt, p: BossParams) => {
    const pts = wave(root, [root[0] - len * 0.8, root[1] - len * 0.55 + sin(p.t) * 4], 8, 6, p.t * 6, r * 0.6, r);
    tube(b, pts, fur);
    if (tip) { const e = pts[pts.length - 1]; b.ellipse(e[0], e[1], r * 0.9, r * 0.9, tip, { rim: false }); }
  };
}

function nineTails(fur: Material, flame: Material) {
  return (b: PixelBuffer, root: Pt, p: BossParams) => {
    for (let i = 0; i < 9; i++) {
      const ang = 205 + i * 15 + sin(p.t + i / 9) * 4;
      const end = add(root, dirOf(ang), 56 + (i % 3) * 6);
      const pts = wave(root, end, 7, 5, p.t * 6 + i, 3, 6.5);
      tube(b, pts, i % 2 ? fur : farSide(fur));
      const e = pts[pts.length - 1];
      b.ellipse(e[0], e[1], 4.5 + p.glow, 5.5 + p.glow, flame, { rim: false });
    }
  };
}

function foxHead(fur: Material, mark: Material, eyeM: Material, s = 1) {
  return (b: PixelBuffer, [x, y]: Pt, p: BossParams) => {
    const open = p.mouth * 5 * s;
    b.poly([[x - 7 * s, y - 4 * s], [x - 9 * s, y - 22 * s], [x + 1 * s, y - 8 * s]], fur);
    b.poly([[x - 1 * s, y - 7 * s], [x + 2 * s, y - 24 * s], [x + 9 * s, y - 6 * s]], fur);
    b.poly([[x + 1 * s, y - 9 * s], [x + 2.5 * s, y - 19 * s], [x + 6 * s, y - 7 * s]], mark, { clip: true, rim: false });
    b.ellipse(x, y, 11 * s, 9 * s, fur);
    b.poly([[x + 3 * s, y - 4 * s], [x + 24 * s, y + 1 * s], [x + 22 * s, y + 4 * s], [x + 4 * s, y + 6 * s]], fur);
    b.poly([[x + 3 * s, y + 4 * s], [x + 20 * s, y + 4 * s + open], [x + 4 * s, y + 8 * s]], farSide(fur));
    b.ellipse(x + 23.5 * s, y + 1.5 * s, 1.8 * s, 1.5 * s, W("#111827"), { rim: false });
    // red markings
    b.capsule(x - 2 * s, y - 2 * s, x + 10 * s, y - 5 * s, 1.2 * s, 0.5 * s, mark, { clip: true, rim: false });
    eye(b, x + 5 * s, y - 2 * s, 2 * s, eyeM, true);
  };
}

function sphinxHead(skin: Material, cloth: Material, stripe: Material, eyeM: Material, s = 1) {
  return (b: PixelBuffer, [x, y]: Pt, p: BossParams) => {
    // nemes headdress: wide lappets
    b.poly([[x - 16 * s, y - 10 * s], [x + 6 * s, y - 16 * s], [x + 12 * s, y - 4 * s], [x + 10 * s, y + 22 * s], [x - 2 * s, y + 28 * s], [x - 18 * s, y + 22 * s]], cloth);
    for (let i = 0; i < 5; i++) b.line(x - 16 * s, y - 6 * s + i * 6 * s, x + 8 * s, y - 10 * s + i * 6 * s, stripe.ramp[2]);
    b.ellipse(x + 6 * s, y + 2 * s, 9 * s, 11 * s, skin);
    b.poly([[x + 8 * s, y - 2 * s], [x + 17 * s, y + 6 * s], [x + 13 * s, y + 9 * s]], skin);
    b.poly([[x + 4 * s, y + 13 * s], [x + 13 * s, y + 12 * s], [x + 9 * s, y + 24 * s]], stripe, { rim: false }); // ceremonial beard
    eye(b, x + 11 * s, y, 1.8 * s, eyeM);
    b.line(x + 8 * s, y - 2.5 * s, x + 15 * s, y - 2 * s, W("#111827").ramp[2]);
    b.line(x + 13 * s, y + 1 * s, x + 16 * s, y + 3 * s, W("#111827").ramp[2]);  // kohl wing
    const my = y + 9 * s;
    b.line(x + 10 * s, my, x + 14 * s, my, skin.ramp[0]);
    if (p.mouth > 0.5) b.line(x + 10 * s, my + 1 * s, x + 13 * s, my + 1 * s, W("#450a0a").ramp[2]);
    // uraeus cobra on the brow
    b.capsule(x + 10 * s, y - 9 * s, x + 13 * s, y - 14 * s, 1.6 * s, 1.2 * s, stripe);
  };
}

function featherWing(main: Material, tip: Material, span: number, lift: number) {
  return (b: PixelBuffer, root: Pt, p: BossParams) => {
    const flap = lift + sin(p.t) * 6 + p.glow * 4 - p.recoil * 8;
    for (let i = 0; i < 6; i++) {
      const ang = 205 + i * 12 - flap * 0.6;
      const len = span * (0.55 + i * 0.09);
      const a = add(root, dirOf(ang - 20), 4), e = add(root, dirOf(ang), len);
      b.poly([a, e, add(e, dirOf(ang + 100), 8), add(root, dirOf(ang + 40), 10)], i % 2 ? main : farSide(main));
      b.ellipse(e[0], e[1], 3, 3, tip, { clip: true, rim: false });
    }
  };
}

function crocHead(skin: Material, eyeM: Material, s = 1) {
  return (b: PixelBuffer, [x, y]: Pt, p: BossParams) => {
    const open = p.mouth * 10 * s;
    b.ellipse(x, y, 12 * s, 10 * s, skin);
    // long upper snout + lower jaw, both lined with teeth
    b.poly([[x + 2 * s, y - 7 * s], [x + 38 * s, y - 1 * s], [x + 40 * s, y + 4 * s], [x + 4 * s, y + 5 * s]], skin);
    b.poly([[x + 2 * s, y + 5 * s], [x + 36 * s, y + 5 * s + open], [x + 36 * s, y + 10 * s + open], [x, y + 11 * s]], farSide(skin));
    if (open > 1) b.poly([[x + 4 * s, y + 5 * s], [x + 38 * s, y + 4 * s], [x + 35 * s, y + 5 * s + open]], W("#7f1d1d"), { rim: false });
    for (let i = 0; i < 8; i++) { fang(b, x + 8 * s + i * 4 * s, y + 4 * s, 2.6 * s); fang(b, x + 7 * s + i * 4 * s, y + 5 * s + open, -2.4 * s, false); }
    for (let i = 0; i < 5; i++) b.ellipse(x + 8 * s + i * 6 * s, y - 4 * s, 1.4 * s, 1 * s, skin, { bias: 0.25, clip: true, rim: false });
    eye(b, x + 4 * s, y - 6 * s, 2.6 * s, eyeM, true);
    b.ellipse(x + 38 * s, y - 1 * s, 1.6 * s, 1.2 * s, W("#111827"), { rim: false });
  };
}

// ── serpents (Hydra, Jörmungandr, Naga) ───────────────────────────────────────
function serpentHead(scale: Material, eyeM: Material, crest: Material | null, s = 1) {
  return (b: PixelBuffer, x: number, y: number, ang: number, p: BossParams) => {
    const d = dirOf(ang), n = dirOf(ang - 90);
    const open = p.mouth * 6 * s;
    const P2 = (u: number, v: number): Pt => [x + d[0] * u + n[0] * v, y + d[1] * u + n[1] * v];
    if (crest) for (let i = 0; i < 3; i++) b.poly([P2(-6 * s + i * 4 * s, -5 * s), P2(-12 * s + i * 4 * s, -14 * s), P2(-2 * s + i * 4 * s, -5 * s)], crest);
    b.poly([P2(-8 * s, -6 * s), P2(10 * s, -6 * s), P2(20 * s, -2 * s), P2(20 * s, 1 * s), P2(-6 * s, 4 * s)], scale);
    b.poly([P2(-6 * s, 3 * s), P2(18 * s, 1 * s + open), P2(16 * s, 4 * s + open), P2(-6 * s, 6 * s)], farSide(scale));
    if (open > 1) {
      b.poly([P2(-2 * s, 2.5 * s), P2(19 * s, 0.5 * s), P2(17 * s, 1 * s + open)], W("#7f1d1d"), { rim: false });
      const f1 = P2(15 * s, 0.5 * s), f2 = P2(11 * s, 1 * s);
      fang(b, f1[0], f1[1], 3.4 * s); fang(b, f2[0], f2[1], 2.4 * s);
    }
    const e = P2(5 * s, -3 * s);
    eye(b, e[0], e[1], 1.9 * s, eyeM, true);
  };
}

function hydra(scale: Material, belly: Material, eyeM: Material, crest: Material) {
  const head = serpentHead(scale, eyeM, crest, 1.1);
  return (b: PixelBuffer, foot: Pt, p: BossParams) => {
    const bx = foot[0] - 20 - p.recoil * 8, by = foot[1] - 26 + p.sink;
    // coiled body mound + tail
    tube(b, wave([bx - 70, foot[1] - 8], [bx - 20, foot[1] - 12], 6, 6, p.t * 6, 4, 14), scale, belly);
    b.ellipse(bx, by, 46, 28, scale);
    b.ellipse(bx + 6, by + 12, 34, 13, belly, { clip: true, rim: false });
    // five necks: back to front
    const necks = [[-30, 150, 0.0], [-12, 120, 0.15], [10, 110, 0.3], [26, 100, 0.45], [36, 125, 0.6]] as const;
    necks.forEach(([dx, len, ph], i) => {
      const far = i % 2 === 0 && i < 4;
      const base: Pt = [bx + dx, by - 14];
      const reach = Math.max(0, p.reach) * (i === 3 ? 34 : 14) - p.recoil * 14;
      const sway = sin(p.t + ph) * 8;
      const tip: Pt = [base[0] + 30 + reach + sway + i * 4, base[1] - len * 0.85 + Math.max(0, p.reach) * 20 + p.recoil * 10 + (p.fall ? -p.fall * 1.2 : 0)];
      const pts = wave(base, tip, 7, 10, p.t * 6 + i, 10, 6);
      tube(b, pts, far ? farSide(scale) : scale, far ? undefined : belly);
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      const ang = Math.atan2(last[0] - prev[0], last[1] - prev[1]) * 180 / Math.PI;
      head(b, last[0], last[1], (ang * 0.25 + 95 * 0.75) + (p.reach > 0 ? 15 : 0), { ...p, mouth: i === 3 ? p.mouth : p.mouth * 0.5 + sin(p.t + ph) * 0.15 });
    });
  };
}

function bigSerpent(scale: Material, belly: Material, eyeM: Material, fin: Material) {
  const head = serpentHead(scale, eyeM, fin, 2.0);
  return (b: PixelBuffer, foot: Pt, p: BossParams) => {
    const gy = foot[1] - 10 + p.sink;
    const lean = Math.max(0, p.reach) * 30 - p.recoil * 16;
    // ground coils (back)
    tube(b, wave([foot[0] - 120, gy], [foot[0] + 40, gy - 4], 10, 8, p.t * 6, 6, 17), farSide(scale));
    // rising body: S-curve
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const u = i / 14;
      const x = foot[0] - 30 + Math.sin(u * Math.PI * 1.3 + p.t * 2) * 34 * (1 - u * 0.4) + u * (40 + lean);
      const y = gy - u * 165 + p.recoil * u * 20 + Math.max(0, p.reach) * u * 30;
      pts.push([x, y, 19 - u * 6]);
    }
    tube(b, pts, scale, belly);
    // dorsal fin spikes
    for (let i = 3; i < 13; i += 2) {
      const [x, y, r] = pts[i];
      b.poly([[x - r * 0.9, y + 2], [x - r * 1.6, y - 6], [x - r * 0.4, y - 3]], fin);
    }
    const [hx, hy] = pts[pts.length - 1];
    head(b, hx, hy, 100 + (p.reach > 0 ? 18 * p.reach : 0) - p.recoil * 10, p);
  };
}

function naga(scale: Material, belly: Material, skin: Material, gold: Material, eyeM: Material) {
  return (b: PixelBuffer, foot: Pt, p: BossParams) => {
    const gy = foot[1] - 10 + p.sink;
    // coiled serpent tail
    tube(b, wave([foot[0] - 110, gy - 2], [foot[0] - 10, gy - 6], 9, 7, p.t * 6, 6, 18), scale, belly);
    b.ellipse(foot[0] - 10, gy - 14, 30, 20, scale);
    // upright torso from the coil
    const lean = Math.max(0, p.reach) * 16 - p.recoil * 12;
    const hip: Pt = [foot[0] - 4 + lean * 0.3, gy - 26];
    const chest: Pt = [hip[0] + lean * 0.8 + 4, hip[1] - 50 + p.bob];
    tube(b, [[hip[0], hip[1], 17], [lerpPt(hip, chest, 0.5)[0], lerpPt(hip, chest, 0.5)[1], 13], [chest[0], chest[1], 16]], skin);
    b.ellipse(hip[0] + 4, hip[1] + 4, 14, 7, belly, { rim: false });
    // cobra hood behind the head
    const head: Pt = [chest[0] + 6, chest[1] - 22];
    b.ellipse(head[0] - 6, head[1] + 2, 27, 31, scale);
    b.ellipse(head[0] - 4, head[1] + 4, 17, 22, belly, { clip: true, rim: false });
    for (let i = 0; i < 3; i++) b.ellipse(head[0] - 18 + i * 4, head[1] - 6 + i * 6, 2, 2, gold, { clip: true, rim: false });
    // arms (two pairs)
    const arms: [number, number, boolean][] = [[-8, 0, true], [-6, 18, true], [8, 0, false], [9, 18, false]];
    for (const [dx, dy, far] of arms) {
      const sh: Pt = [chest[0] + dx, chest[1] + 4 + dy];
      const r = p.reach > 0 ? p.reach : 0;
      const el: Pt = [sh[0] + (far ? -6 : 12) + r * 10, sh[1] + 14 - (p.glow > 0 ? 20 : 0) - r * 6];
      const ha: Pt = [el[0] + (far ? 4 : 16) + r * 18, el[1] + (p.glow > 0 ? -16 : 2) - r * 8];
      const m = far ? farSide(skin) : skin;
      b.capsule(sh[0], sh[1], el[0], el[1], 5, 4, m); b.capsule(el[0], el[1], ha[0], ha[1], 4, 3.4, m);
      b.capsule(...lerpPt(el, ha, 0.75), ...lerpPt(el, ha, 0.85), 4.2, 4.2, gold, { rim: false });
      b.ellipse(ha[0], ha[1], 3.6, 3.2, m);
    }
    b.ellipse(chest[0] + 2, chest[1] + 2, 12, 5, gold); // necklace
    // face
    b.capsule(chest[0], chest[1], head[0], head[1] + 6, 5, 5, skin);
    b.ellipse(head[0], head[1], 12.5, 13.5, skin);
    b.poly([[head[0] + 2, head[1]], [head[0] + 14, head[1] + 6], [head[0] + 8, head[1] + 14], [head[0], head[1] + 13]], skin, { rim: false });
    eye(b, head[0] + 8, head[1] - 1, 2.4, eyeM, true);
    if (p.mouth > 0.4) { b.line(head[0] + 6, head[1] + 7, head[0] + 10, head[1] + 7, W("#450a0a").ramp[2]); fang(b, head[0] + 9, head[1] + 7, 2.4); }
    b.poly([[head[0] - 8, head[1] - 8], [head[0] + 8, head[1] - 10], [head[0] + 4, head[1] - 18], [head[0], head[1] - 12], [head[0] - 5, head[1] - 19]], gold);
    b.ellipse(head[0], head[1] - 11, 1.8, 1.8, W("#ef4444", { emissive: true }), { rim: false });
  };
}

// ── one-offs ──────────────────────────────────────────────────────────────────
function simurgh(body: Material, wing: Material, tail: Material, gold: Material, eyeM: Material) {
  const w = featherWing(wing, gold, 110, 10);
  return (b: PixelBuffer, foot: Pt, p: BossParams) => {
    const hover = -18 + sin(p.t) * 4 - Math.max(0, -p.reach) * 6 + p.sink;
    const cx = foot[0] - 6 + Math.max(0, p.reach) * 22 - p.recoil * 10, cy = foot[1] - 80 + hover;
    // peacock tail plumes with eye-spots
    for (let i = 0; i < 7; i++) {
      const ang = 230 + i * 12 + sin(p.t + i / 7) * 3;
      const end = add([cx - 20, cy + 14], dirOf(ang), 80 + (i % 2) * 14);
      tube(b, wave([cx - 20, cy + 14], end, 6, 4, p.t * 6 + i, 3, 7), i % 2 ? tail : farSide(tail));
      b.ellipse(end[0], end[1], 6, 7, gold, { rim: false });
      b.ellipse(end[0], end[1], 3, 3.5, W("#1d4ed8"), { rim: false });
    }
    w(b, [cx - 4, cy - 14], p);                                   // far wing
    // legs with talons
    for (const [dx, far] of [[-6, true], [8, false]] as const) {
      const hip: Pt = [cx + dx, cy + 16], k: Pt = [hip[0] + 4, hip[1] + 26 - hover * 0.3];
      b.capsule(hip[0], hip[1], k[0], k[1], 4, 2.6, far ? farSide(gold) : gold);
      for (let t = -1; t <= 1; t++) b.capsule(k[0], k[1], k[0] + 6 + t * 2, k[1] + 6 + Math.abs(t), 1.6, 0.6, far ? farSide(gold) : gold);
    }
    b.ellipse(cx, cy, 34, 26, body);
    b.ellipse(cx + 10, cy + 8, 21, 15, gold, { clip: true, rim: false });
    // neck + head with crest and hooked beak
    const hx = cx + 26 + Math.max(0, p.reach) * 8, hy = cy - 30 + p.recoil * 8;
    b.capsule(cx + 14, cy - 8, hx, hy + 4, 13, 9, body);
    for (let i = 0; i < 4; i++) b.poly([[hx - 6 + i * 2, hy - 6], [hx - 14 + i * 3, hy - 24 - i * 2], [hx - 2 + i * 2, hy - 7]], i % 2 ? gold : wing);
    b.ellipse(hx, hy, 12, 11, body);
    const open = p.mouth * 5;
    b.poly([[hx + 5, hy - 4], [hx + 20, hy], [hx + 16, hy + 5], [hx + 6, hy + 2]], gold);
    b.poly([[hx + 5, hy + 2], [hx + 15, hy + 4 + open], [hx + 6, hy + 6]], farSide(gold));
    eye(b, hx + 3, hy - 2, 1.8, eyeM);
    w(b, [cx + 4, cy - 10], { ...p, t: p.t + 0.12 });              // near wing
  };
}

function kraken(skin: Material, sucker: Material, eyeM: Material) {
  return (b: PixelBuffer, foot: Pt, p: BossParams) => {
    const gy = foot[1] + p.sink;
    const lean = Math.max(0, p.reach) * 20 - p.recoil * 12;
    const mx = foot[0] - 10 + lean, my = gy - 120 + p.bob * 1.5 + p.recoil * 6;
    // tentacles: 4 behind, 4 in front
    const tent = (i: number, front: boolean) => {
      const base: Pt = [mx - 24 + i * 14, my + 40];
      const spread = (i - 1.5) * 26;
      const strike = front && i === 3 ? Math.max(0, p.reach) * 60 : 0;
      const end: Pt = [base[0] + spread + strike + (front ? 18 : -10), gy - (front ? 6 : 18) - strike * 0.8 - (p.glow > 0 ? 40 : 0)];
      const pts = wave(base, end, 10, 12, p.t * 6 + i * 1.3 + (front ? 0 : 2), 11, 3);
      tube(b, pts, front ? skin : farSide(skin));
      if (front) for (let k = 3; k < pts.length - 1; k += 2) b.ellipse(pts[k][0], pts[k][1] + pts[k][2] * 0.5, pts[k][2] * 0.35, pts[k][2] * 0.3, sucker, { clip: true, rim: false });
      // curl at the end
      const e = pts[pts.length - 1];
      b.capsule(e[0], e[1], e[0] + (front ? 6 : -6), e[1] - 6, 2.6, 1.2, front ? skin : farSide(skin));
    };
    for (let i = 0; i < 4; i++) tent(i, false);
    // mantle
    b.ellipse(mx - 6, my - 26, 36, 52, skin, {}, -0.25 - lean * 0.004);
    for (let i = 0; i < 6; i++) b.ellipse(mx - 26 + i * 8, my - 50 + (i % 2) * 14, 3, 2.4, sucker, { clip: true, rim: false, bias: -0.1 });
    // head with two huge eyes
    b.ellipse(mx + 4, my + 18, 34, 26, skin);
    b.ellipse(mx - 14, my + 14, 10, 9, farSide(eyeM), { rim: false });
    b.ellipse(mx + 18, my + 12, 12, 10, eyeM, { rim: false });
    b.ellipse(mx + 20, my + 12, 4, 8, W("#0a0a0a"), { rim: false });
    b.set(Math.floor(mx + 23), Math.floor(my + 7), eyeM.ramp[4]);
    b.line(mx + 6, my + 3, mx + 30, my + 1, skin.ramp[0]);
    for (let i = 0; i < 4; i++) tent(i, true);
  };
}

// ── the bestiary ──────────────────────────────────────────────────────────────
const RED_EYE = W("#ef4444", { emissive: true }), GOLD_EYE = W("#facc15", { emissive: true }), ICE_EYE = W("#67e8f9", { emissive: true });
const GREEN_EYE = W("#a3e635", { emissive: true });

export const BOSSES: Record<string, BossDef> = {
  minotaur: {
    id: "minotaur", name: "Minotaur", origin: "Greek", stage: "labyrinth", accent: "#d97706",
    paint: giant({
      skin: W("#7c4a2d"), top: W("#7c4a2d"), topStyle: "bare", sleeves: "none", pants: W("#3f2a1d"), baggy: true, boots: W("#2a1b12"),
      belt: W("#a16207", { shiny: true }), pauldrons: W("#57534e", { shiny: true }), eye: RED_EYE,
      headPainter: bullHead(W("#6b3b22"), W("#e7e5e4"), RED_EYE, W("#facc15", { shiny: true })),
      weapon: "axe", weaponMat: W("#9ca3af", { shiny: true }), weaponAccent: W("#44261a"),
    }, "overhead"),
  },
  cyclops: {
    id: "cyclops", name: "Cyclops", origin: "Greek", stage: "forge", accent: "#38bdf8",
    paint: giant({
      skin: W("#8fa98c"), top: W("#8fa98c"), topStyle: "bare", sleeves: "none", pants: W("#5b4636"), baggy: true, boots: W("#3b2f25"),
      belt: W("#3b2f25"), gloves: W("#57534e"), eye: ICE_EYE,
      headPainter: cyclopsHead(W("#8fa98c"), W("#38bdf8", { emissive: true }), W("#d6d3d1")),
      weapon: "boulder", weaponMat: W("#78716c"), weaponAccent: W("#78716c"),
    }, "throw"),
  },
  oni: {
    id: "oni", name: "Oni", origin: "Japanese", stage: "shrine", accent: "#ef4444",
    paint: giant({
      skin: W("#c2410c"), top: W("#c2410c"), topStyle: "bare", sleeves: "none", pants: W("#eab308"), baggy: true, boots: W("#7c2d12"),
      belt: W("#1c1917"), eye: GOLD_EYE, scarf: W("#e5e7eb"),
      headPainter: oniHead(W("#c2410c"), W("#1c1917"), W("#fef3c7"), GOLD_EYE),
      weapon: "club", weaponMat: W("#d4d4d8", { shiny: true }), weaponAccent: W("#292524"),
    }, "overhead"),
  },
  rakshasa: {
    id: "rakshasa", name: "Rakshasa", origin: "Indian", stage: "temple", accent: "#a855f7",
    paint: giant({
      skin: W("#ea8a2e"), top: W("#581c87"), topStyle: "robe", coat: W("#6b21a8"), sleeves: "short", sleeveMat: W("#7e22ce"),
      pants: W("#3b0764"), boots: W("#3b0764"), belt: W("#facc15", { shiny: true }), pauldrons: W("#facc15", { shiny: true }), eye: GOLD_EYE,
      headPainter: tigerHead(W("#ea8a2e"), W("#1c1917"), W("#a3e635", { emissive: true }), W("#facc15", { shiny: true })),
      weapon: "claws", weaponMat: W("#f5f5f4", { shiny: true }), weaponAccent: W("#f5f5f4"),
    }, "claw"),
  },
  fenrir: {
    id: "fenrir", name: "Fenrir", origin: "Norse", stage: "frost", accent: "#67e8f9",
    paint: quadruped({
      body: W("#3f4a5c"), belly: W("#8b9bb0"), paw: W("#2b3444"), bodyRx: 58, bodyRy: 34, legLen: 46, legR: 8, neckLen: 26,
      head: wolfHead(W("#46536a"), ICE_EYE, 2.1),
      tail: bushyTail(W("#46536a"), null, 70, 14),
      front: (b, [x, y], p) => {
        // ragged mane and a broken golden chain
        for (let i = 0; i < 7; i++) b.poly([[x + 20 + i * 5, y - 24], [x + 12 + i * 6, y - 42 - (i % 2) * 6 + sin(p.t) * 2], [x + 28 + i * 5, y - 26]], W("#334155"));
        for (let i = 0; i < 4; i++) b.ellipse(x + 34 + i * 5, y + 26 + i * 3, 3, 2.2, W("#facc15", { shiny: true }), { rim: false });
      },
    }),
  },
  kitsune: {
    id: "kitsune", name: "Kitsune", origin: "Japanese", stage: "shrine", accent: "#60a5fa",
    paint: quadruped({
      body: W("#f1f5f9", { contrast: 1.3 }), belly: W("#fde68a"), paw: W("#e2e8f0"), bodyRx: 44, bodyRy: 24, legLen: 44, legR: 6, neckLen: 28,
      head: (b, at, p) => foxHead(W("#f1f5f9", { contrast: 1.3 }), W("#dc2626"), W("#facc15", { emissive: true }), 1.5)(b, at, p),
      tail: nineTails(W("#f8fafc", { contrast: 1.3 }), W("#60a5fa", { emissive: true })),
    }),
  },
  sphinx: {
    id: "sphinx", name: "Sphinx", origin: "Egyptian", stage: "desert", accent: "#facc15",
    paint: quadruped({
      body: W("#d4a056"), belly: W("#e9c890"), paw: W("#b78340"), bodyRx: 56, bodyRy: 32, legLen: 40, legR: 8.5, neckLen: 22,
      head: sphinxHead(W("#c98f4a"), W("#1d4ed8"), W("#facc15", { shiny: true }), W("#1e293b"), 1.6),
      tail: bushyTail(W("#c98f4a"), W("#7c4a2d"), 60, 4),
      back: (b, [x, y], p) => featherWing(W("#b45309"), W("#facc15", { shiny: true }), 70, 30)(b, [x - 10, y - 22], p),
    }),
  },
  ammit: {
    id: "ammit", name: "Ammit", origin: "Egyptian", stage: "underworld", accent: "#22c55e",
    paint: quadruped({
      body: W("#5b6b52"), belly: W("#a39272"), paw: W("#3f4a38"), bodyRx: 58, bodyRy: 34, legLen: 36, legR: 10, neckLen: 16,
      head: crocHead(W("#4d7c3c"), GREEN_EYE, 1.5),
      tail: bushyTail(W("#5b6b52"), null, 60, 9),
      front: (b, [x, y], p) => {
        // a lion's mane over the shoulders
        for (let i = 0; i < 9; i++) {
          const a = 150 + i * 22, base: Pt = [x + 38, y - 18];
          b.poly([add(base, dirOf(a + 80), 7), add(base, dirOf(a + sin(p.t) * 5), 26), add(base, dirOf(a - 80), 7)], i % 2 ? W("#a16207") : W("#854d0e"));
        }
      },
    }),
  },
  hydra: { id: "hydra", name: "Hydra", origin: "Greek", stage: "swamp", accent: "#4ade80", paint: hydra(W("#2f7d4f"), W("#d9c27a"), GOLD_EYE, W("#7c2d12")) },
  jormungandr: { id: "jormungandr", name: "Jörmungandr", origin: "Norse", stage: "sea", accent: "#2dd4bf", paint: bigSerpent(W("#0f766e"), W("#99f6e4"), GOLD_EYE, W("#134e4a")) },
  naga: { id: "naga", name: "Naga", origin: "Indian", stage: "temple", accent: "#34d399", paint: naga(W("#065f46"), W("#fde68a"), W("#3b7f95"), W("#facc15", { shiny: true }), GOLD_EYE) },
  simurgh: { id: "simurgh", name: "Simurgh", origin: "Persian", stage: "peaks", accent: "#f472b6", paint: simurgh(W("#be123c"), W("#0d9488"), W("#0e7490"), W("#facc15", { shiny: true }), W("#111827")) },
  kraken: { id: "kraken", name: "Kraken", origin: "Norse", stage: "sea", accent: "#fb7185", paint: kraken(W("#9f1239"), W("#fda4af"), W("#facc15", { emissive: true })) },
};

export const DEFAULT_BOSS = "hydra";
export const bossById = (id: string | null | undefined): BossDef => (id && BOSSES[id]) || BOSSES[DEFAULT_BOSS];
