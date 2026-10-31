/**
 * The humanoid rig: a 2D skeleton posed by joint angles (forward kinematics) and drawn part by part, back to front,
 * with the pixel buffer's shaded shapes. Heroes and the giant bosses (Minotaur, Oni, Cyclops, Rakshasa) share it -
 * they differ by proportions, materials, head, outfit and weapon.
 *
 * Angles are degrees. A limb angle of 0 points straight down, +90 points forward (the way the figure faces, +x),
 * -90 backward. Elbows bend forward (+), knees bend backward (-). The figure always faces right; the scene mirrors
 * the boss.
 */
import { PixelBuffer, type Pt } from "./buffer";
import { farSide, type Material } from "./color";

export interface Pose {
  /** Hip offset from the rest position (px, scaled). */
  x?: number; y?: number;
  /** Torso lean from vertical (+ forward). */
  lean?: number;
  /** Head tilt on top of the lean (+ chin down). */
  head?: number;
  fs?: number; fe?: number;      // front shoulder / elbow
  bs?: number; be?: number;      // back shoulder / elbow
  fh?: number; fk?: number;      // front hip / knee
  bh?: number; bk?: number;      // back hip / knee
  /** Weapon angle relative to the front forearm. */
  wpn?: number;
  /** Cloth sway (-1..1): coat tails, cape, scarf, hair. */
  sway?: number;
  /** Eyes: "open" | "closed" | "angry" | "hurt". */
  eyes?: "open" | "closed" | "angry" | "hurt";
  /** Mouth open (shout / roar). */
  shout?: boolean;
  /** Free slot for effects a look draws itself (glow strength, charge...). */
  glow?: number;
  /** Ground-plane tilt for KO (the whole figure rotates around the feet). */
  fall?: number;
}

export interface Build {
  headR: number; neck: number; torso: number;
  upper: number; fore: number; thigh: number; shin: number; foot: number;
  shoulderW: number; waistW: number; hipW: number;
  armR: number; foreR: number; handR: number; thighR: number; shinR: number;
}

export const HERO_BUILD: Build = {
  headR: 7.2, neck: 2, torso: 21, upper: 11, fore: 10, thigh: 16, shin: 16, foot: 6,
  shoulderW: 15, waistW: 10.5, hipW: 12.5, armR: 3.2, foreR: 2.7, handR: 2.6, thighR: 4.3, shinR: 3.3,
};

export type WeaponKind = "katana" | "spear" | "staff" | "daggers" | "greatsword" | "gauntlets" | "axe" | "club" | "claws" | "boulder" | "none";

export interface Skeleton {
  hip: Pt; chest: Pt; neck: Pt; headC: Pt;
  up: Pt; fwd: Pt;
  fShoulder: Pt; fElbow: Pt; fHand: Pt;
  bShoulder: Pt; bElbow: Pt; bHand: Pt;
  fHip: Pt; fKnee: Pt; fAnkle: Pt;
  bHip: Pt; bKnee: Pt; bAnkle: Pt;
  foreDir: Pt; bForeDir: Pt;
  s: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
export const dirOf = (deg: number): Pt => [Math.sin(rad(deg)), Math.cos(rad(deg))];
export const add = (a: Pt, b: Pt, k = 1): Pt => [a[0] + b[0] * k, a[1] + b[1] * k];
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Joint positions for a pose. `foot` is the ground point under the figure (the sprite's anchor). */
export function solve(build: Build, pose: Pose, foot: Pt, s: number): Skeleton {
  const b = build;
  const legLen = (b.thigh + b.shin) * s;
  const lean = pose.lean ?? 0;
  const hip: Pt = [foot[0] + (pose.x ?? 0) * s, foot[1] - legLen - 2 * s + (pose.y ?? 0) * s];
  const up: Pt = [Math.sin(rad(lean)), -Math.cos(rad(lean))];
  const fwd: Pt = [Math.cos(rad(lean)), Math.sin(rad(lean))];
  const chest = add(hip, up, b.torso * s);
  const neck = add(chest, up, b.neck * s);
  const hl = lean + (pose.head ?? 0) * 0.6;
  const headC = add(neck, [Math.sin(rad(hl)), -Math.cos(rad(hl))], b.headR * s * 0.92);

  const fShoulder = add(add(chest, fwd, 2.2 * s), up, -1.6 * s);
  const bShoulder = add(add(chest, fwd, -3.2 * s), up, -1.2 * s);
  const fs = (pose.fs ?? 10) + lean, bs = (pose.bs ?? -6) + lean;
  const fElbow = add(fShoulder, dirOf(fs), b.upper * s);
  const foreDir = dirOf(fs + (pose.fe ?? 12));
  const fHand = add(fElbow, foreDir, b.fore * s);
  const bElbow = add(bShoulder, dirOf(bs), b.upper * s);
  const bForeDir = dirOf(bs + (pose.be ?? 14));
  const bHand = add(bElbow, bForeDir, b.fore * s);

  const fHip = add(hip, fwd, 2.4 * s), bHip = add(hip, fwd, -2.4 * s);
  const fh = pose.fh ?? 8, bh = pose.bh ?? -8;
  const fKnee = add(fHip, dirOf(fh), b.thigh * s);
  const fAnkle = add(fKnee, dirOf(fh + (pose.fk ?? -4)), b.shin * s);
  const bKnee = add(bHip, dirOf(bh), b.thigh * s);
  const bAnkle = add(bKnee, dirOf(bh + (pose.bk ?? -6)), b.shin * s);
  return { hip, chest, neck, headC, up, fwd, fShoulder, fElbow, fHand, bShoulder, bElbow, bHand, fHip, fKnee, fAnkle, bHip, bKnee, bAnkle, foreDir, bForeDir, s };
}

// ── looks ─────────────────────────────────────────────────────────────────────

export interface HumanoidLook {
  build: Build;
  scale: number;
  skin: Material;
  /** Shirt / armour / bare torso. */
  top: Material;
  topStyle: "coat" | "gi" | "armor" | "robe" | "tank" | "jacket" | "bare";
  /** The long coat over the top (topStyle coat / robe), with its tail length in px. */
  coat?: Material; coatLen?: number;
  /** Sleeves: "long" (top colour to the wrist), "short", "none" (bare arms). */
  sleeves: "long" | "short" | "none";
  sleeveMat?: Material;
  pants: Material;
  /** Baggy trousers (wider legs). */
  baggy?: boolean;
  boots: Material;
  belt?: Material;
  gloves?: Material;
  scarf?: Material;
  cape?: Material;
  pauldrons?: Material;
  /** Head: a hair style for heroes, or a custom painter (boss heads). */
  hair?: { style: "spiky" | "ponytail" | "bob" | "wild" | "slick" | "hood" | "topknot"; mat: Material };
  headPainter?: (b: PixelBuffer, k: Skeleton, pose: Pose, look: HumanoidLook) => void;
  eye: Material;
  weapon: WeaponKind;
  weaponMat?: Material; weaponAccent?: Material; weaponGlow?: Material;
  /** Extra layers drawn last (auras, horns...). */
  extra?: (b: PixelBuffer, k: Skeleton, pose: Pose, look: HumanoidLook) => void;
}

/** Draw a whole humanoid into `b`, standing on `foot`. */
export function drawHumanoid(b: PixelBuffer, look: HumanoidLook, pose: Pose, foot: Pt) {
  const s = look.scale;
  const k = solve(look.build, pose, foot, s);
  const B = look.build;
  const sway = pose.sway ?? 0;
  const far = (m: Material) => farSide(m);

  // 1 ─ things behind the body: cape, back weapon hand, back arm, back leg
  if (look.cape) drawCape(b, k, look.cape, sway, look);
  if (look.weapon === "daggers") drawWeapon(b, k, look, pose, "back");
  drawArm(b, k, look, "back", far);
  drawLeg(b, k, look, "back", far);
  if (look.coat && look.coatLen) drawCoatTail(b, k, look.coat, look.coatLen * s, sway, true);

  // 2 ─ body
  drawTorso(b, k, look, B);
  drawLeg(b, k, look, "front", (m) => m);
  if (look.topStyle === "robe" && look.coat) drawRobeSkirt(b, k, look.coat, look, sway);
  if (look.coat && look.coatLen) drawCoatTail(b, k, look.coat, look.coatLen * s, sway, false);
  if (look.belt) drawBelt(b, k, look.belt, B, s);
  if (look.scarf) drawScarf(b, k, look.scarf, sway, s);

  // 3 ─ head
  if (look.headPainter) look.headPainter(b, k, pose, look);
  else drawHeroHead(b, k, pose, look);

  // 4 ─ front arm and weapon (two-handed weapons sit between the hands)
  const twoHanded = look.weapon === "greatsword" || look.weapon === "spear" || look.weapon === "staff" || look.weapon === "axe" || look.weapon === "club";
  if (twoHanded) drawWeapon(b, k, look, pose, "front");
  drawArm(b, k, look, "front", (m) => m);
  if (!twoHanded) drawWeapon(b, k, look, pose, "front");
  if (look.pauldrons) {
    b.ellipse(k.fShoulder[0], k.fShoulder[1] + 0.5 * s, 4.2 * s, 3.4 * s, look.pauldrons, {}, rad(-20));
  }
  look.extra?.(b, k, pose, look);
}

function drawTorso(b: PixelBuffer, k: Skeleton, look: HumanoidLook, B: Build) {
  const s = k.s;
  const { hip, chest, up, fwd } = k;
  const waist = add(hip, up, B.torso * s * 0.42);
  const sw = B.shoulderW * s / 2, ww = B.waistW * s / 2, hw = B.hipW * s / 2;
  const shoulderTop = add(chest, up, 1.2 * s);
  const pts: Pt[] = [
    add(add(shoulderTop, fwd, -sw * 0.95), up, -1 * s),
    add(shoulderTop, fwd, sw * 0.75),
    add(add(chest, fwd, sw * 0.95), up, -3 * s),
    add(waist, fwd, ww * 1.05),
    add(hip, fwd, hw),
    add(add(hip, up, -3 * s), fwd, hw * 0.9),
    add(add(hip, up, -3 * s), fwd, -hw * 0.9),
    add(hip, fwd, -hw),
    add(waist, fwd, -ww * 1.1),
    add(add(chest, fwd, -sw), up, -3 * s),
  ];
  // pants top (hips) first, the shirt/torso over it
  b.poly([pts[4], pts[5], pts[6], pts[7], add(hip, up, 4 * s)].map((p) => p) as Pt[], look.pants);
  const bodyMat = look.topStyle === "bare" ? look.skin : look.coat && look.topStyle === "coat" ? look.coat : look.top;
  b.poly(pts.slice(0, 4).concat([add(hip, fwd, hw * 0.95), add(hip, fwd, -hw * 0.95)], pts.slice(8)), bodyMat);

  if (look.topStyle === "coat" && look.coat) {
    // open coat: the shirt shows down the front, collar up
    const a = add(add(chest, fwd, sw * 0.25), up, 1 * s);
    b.poly([a, add(a, fwd, sw * 0.55), add(add(waist, fwd, ww * 0.7), up, -2 * s), add(add(waist, fwd, ww * 0.05), up, -2 * s)], look.top, { rim: true });
    b.capsule(...add(chest, fwd, -sw * 0.6), ...add(add(chest, fwd, sw * 0.3), up, 2.5 * s), 1.6 * s, 1.2 * s, look.coat);
  } else if (look.topStyle === "gi") {
    // V-neck showing skin, crossed lapel
    const n = add(chest, up, 1 * s);
    b.poly([add(n, fwd, -1 * s), add(n, fwd, sw * 0.65), add(add(chest, up, -6 * s), fwd, sw * 0.15)], look.skin, { clip: true });
    b.line(...add(n, fwd, sw * 0.65), ...add(add(chest, up, -8 * s), fwd, -sw * 0.1), look.top.ramp[0]);
  } else if (look.topStyle === "armor") {
    b.ellipse(...add(add(chest, up, -4 * s), fwd, sw * 0.15), sw * 0.85, 6 * s, look.top, { bias: 0.15 });
    b.line(...add(add(chest, up, -1 * s), fwd, sw * 0.2), ...add(waist, fwd, ww * 0.2), look.top.ramp[1]);
  } else if (look.topStyle === "tank" || look.topStyle === "bare") {
    // pecs / abs hint
    const c = add(add(chest, up, -4.5 * s), fwd, sw * 0.25);
    b.line(c[0] - 2 * s, c[1] + 1.5 * s, c[0] + 2.5 * s, c[1] + 1.5 * s, (look.topStyle === "bare" ? look.skin : look.top).ramp[1]);
  } else if (look.topStyle === "jacket") {
    const z0 = add(add(chest, up, 1 * s), fwd, sw * 0.35), z1 = add(waist, fwd, ww * 0.3);
    b.line(z0[0], z0[1], z1[0], z1[1], look.top.ramp[0]);
    b.capsule(...add(chest, fwd, -sw * 0.5), ...add(add(chest, fwd, sw * 0.45), up, 2 * s), 1.5 * s, 1.3 * s, look.top);
  }
}

function sleeveMat(look: HumanoidLook): Material {
  return look.sleeveMat ?? (look.coat && (look.topStyle === "coat" || look.topStyle === "robe") ? look.coat : look.top);
}

function drawArm(b: PixelBuffer, k: Skeleton, look: HumanoidLook, side: "front" | "back", f: (m: Material) => Material) {
  const s = k.s, B = look.build;
  const [sh, el, ha] = side === "front" ? [k.fShoulder, k.fElbow, k.fHand] : [k.bShoulder, k.bElbow, k.bHand];
  const upperM = look.sleeves === "none" ? look.skin : sleeveMat(look);
  const foreM = look.sleeves === "long" ? sleeveMat(look) : look.skin;
  b.capsule(sh[0], sh[1], el[0], el[1], B.armR * s * 1.08, B.armR * s * 0.92, f(upperM));
  if (look.sleeves === "short") b.capsule(sh[0], sh[1], ...lerpPt(sh, el, 0.55), B.armR * s * 1.2, B.armR * s * 1.1, f(sleeveMat(look)));
  b.capsule(el[0], el[1], ha[0], ha[1], B.foreR * s * 1.05, B.foreR * s * 0.85, f(foreM));
  if (look.gloves) b.capsule(...lerpPt(el, ha, 0.45), ha[0], ha[1], B.foreR * s * 1.1, B.foreR * s * 0.95, f(look.gloves));
  else if (look.sleeves === "long") b.capsule(...lerpPt(el, ha, 0.82), ...lerpPt(el, ha, 0.9), B.foreR * s * 1.15, B.foreR * s * 1.15, f(sleeveMat(look)));
  const gauntlet = look.weapon === "gauntlets" && look.weaponMat;
  b.ellipse(ha[0], ha[1], B.handR * s * (gauntlet ? 1.35 : 1), B.handR * s * (gauntlet ? 1.25 : 0.95), f(gauntlet ? look.weaponMat! : look.gloves ?? look.skin));
}

function drawLeg(b: PixelBuffer, k: Skeleton, look: HumanoidLook, side: "front" | "back", f: (m: Material) => Material) {
  const s = k.s, B = look.build;
  const [hp, kn, an] = side === "front" ? [k.fHip, k.fKnee, k.fAnkle] : [k.bHip, k.bKnee, k.bAnkle];
  const bag = look.baggy ? 1.3 : 1;
  b.capsule(hp[0], hp[1], kn[0], kn[1], B.thighR * s * bag, B.shinR * s * 1.15 * bag, f(look.pants));
  const bootTop = lerpPt(kn, an, look.baggy ? 0.62 : 0.4);
  b.capsule(kn[0], kn[1], ...bootTop, B.shinR * s * 1.1 * bag, B.shinR * s * bag, f(look.pants));
  b.capsule(...bootTop, an[0], an[1], B.shinR * s * 1.05, B.shinR * s * 0.9, f(look.boots));
  const toe: Pt = [an[0] + B.foot * s, an[1] + 1.2 * s];
  b.capsule(an[0] - 1 * s, an[1] + 0.3 * s, toe[0], toe[1], 2.2 * s, 1.5 * s, f(look.boots));
}

function drawCoatTail(b: PixelBuffer, k: Skeleton, m: Material, len: number, sway: number, back: boolean) {
  const s = k.s;
  const base = add(k.hip, k.up, 4 * s);
  const flare = 2.5 * s + Math.abs(sway) * 2 * s;
  const off = back ? -1 : 1;
  const top: Pt = add(base, k.fwd, off * (back ? 5.5 : 4.5) * s);
  const top2: Pt = add(base, k.fwd, off * 1 * s);
  const bx = -sway * 4 * s - (back ? 3 : 0) * s;
  const bottom: Pt = [top[0] + off * flare + bx, base[1] + len];
  const bottom2: Pt = [top2[0] + bx * 0.6 + off * 0.5 * s, base[1] + len - 2 * s];
  b.poly([top, top2, bottom2, bottom], back ? farSide(m) : m);
}

function drawRobeSkirt(b: PixelBuffer, k: Skeleton, m: Material, look: HumanoidLook, sway: number) {
  const s = k.s;
  const base = add(k.hip, k.up, 3 * s);
  const groundY = Math.max(k.fAnkle[1], k.bAnkle[1]) - 1 * s;
  const sx = -sway * 3 * s;
  b.poly([
    add(base, k.fwd, -6 * s), add(base, k.fwd, 6 * s),
    [k.fAnkle[0] + 4 * s + sx, groundY], [(k.fAnkle[0] + k.bAnkle[0]) / 2 + sx, groundY + 1 * s], [k.bAnkle[0] - 5 * s + sx, groundY],
  ], m);
  void look;
}

function drawBelt(b: PixelBuffer, k: Skeleton, m: Material, B: Build, s: number) {
  const w = add(k.hip, k.up, 3.2 * s);
  b.capsule(...add(w, k.fwd, -B.hipW * s * 0.5), ...add(w, k.fwd, B.hipW * s * 0.5), 1.4 * s, 1.4 * s, m, { rim: false });
  // knot tails
  const kn = add(w, k.fwd, B.hipW * s * 0.25);
  b.capsule(kn[0], kn[1], kn[0] - 1 * s, kn[1] + 6 * s, 1.2 * s, 0.8 * s, m);
}

function drawScarf(b: PixelBuffer, k: Skeleton, m: Material, sway: number, s: number) {
  const n = add(k.neck, k.up, -1.2 * s);
  b.ellipse(n[0], n[1], 4 * s, 2.4 * s, m);
  // trailing ends flutter behind
  let p: Pt = add(n, k.fwd, -3 * s);
  for (let i = 0; i < 4; i++) {
    const q: Pt = [p[0] - 3.2 * s, p[1] + (1.2 + Math.sin(i * 1.4 + sway * 3) * 1.4) * s];
    b.capsule(p[0], p[1], q[0], q[1], (1.8 - i * 0.25) * s, (1.6 - i * 0.25) * s, m);
    p = q;
  }
}

function drawCape(b: PixelBuffer, k: Skeleton, m: Material, sway: number, look: HumanoidLook) {
  const s = k.s;
  const a = add(k.bShoulder, k.fwd, -1 * s), c = add(k.fShoulder, k.fwd, -1 * s);
  const groundY = Math.max(k.fAnkle[1], k.bAnkle[1]) - 6 * s;
  const sx = -sway * 6 * s - 4 * s;
  b.poly([a, c, [c[0] - 4 * s + sx, groundY], [a[0] - 12 * s + sx * 1.4, groundY + 2 * s]], farSide(m));
  void look;
}

// ── hero heads ────────────────────────────────────────────────────────────────
function drawHeroHead(b: PixelBuffer, k: Skeleton, pose: Pose, look: HumanoidLook) {
  const s = k.s, r = look.build.headR * s;
  const [cx, cy] = k.headC;
  const hair = look.hair;
  const tilt = rad((pose.head ?? 0) * 0.5);
  // hair behind the head (long styles)
  if (hair) hairBack(b, k, pose, hair.style, hair.mat, r);
  // neck
  b.capsule(k.neck[0], k.neck[1] + 1.5 * s, cx - 0.5 * s, cy + r * 0.4, 2 * s, 1.9 * s, look.skin);
  // skull + jaw (the face points forward: jaw pushed to +x)
  b.ellipse(cx, cy, r * 0.9, r, look.skin, {}, tilt);
  b.poly([[cx - r * 0.35, cy + r * 0.2], [cx + r * 0.85, cy + r * 0.15], [cx + r * 0.55, cy + r * 0.8], [cx + r * 0.05, cy + r * 1.02], [cx - r * 0.45, cy + r * 0.7]], look.skin, { rim: false });
  // ear
  b.ellipse(cx - r * 0.12, cy + r * 0.15, 1.3 * s, 1.8 * s, look.skin, { bias: -0.1 });
  // eye: anime style - dark top lash, coloured iris, white glint
  const ex = Math.round(cx + r * 0.5), ey = Math.round(cy + r * 0.12);
  const lash = look.skin.ramp[0];
  const state = pose.eyes ?? "open";
  if (state === "closed" || state === "hurt") {
    b.set(ex - 1, ey + 1, lash); b.set(ex, ey + 1, lash); b.set(ex + 1, ey + (state === "hurt" ? 0 : 1), lash);
  } else {
    b.set(ex - 1, ey - 1, lash); b.set(ex, ey - 1, lash); b.set(ex + 1, ey - 1, lash);
    b.set(ex, ey, look.eye.ramp[2]); b.set(ex, ey + 1, look.eye.ramp[1]); b.set(ex + 1, ey, look.eye.ramp[3]);
    if (s >= 1.4) { b.set(ex - 1, ey, look.eye.ramp[2]); b.set(ex - 1, ey + 1, look.eye.ramp[1]); }
    if (state === "angry") { b.set(ex - 1, ey - 2, lash); b.set(ex + 1, ey - 1, lash); b.set(ex + 2, ey - 1, lash); }
  }
  // brow + mouth
  b.set(ex - 1, ey - 2, hair ? hair.mat.ramp[1] : lash); b.set(ex, ey - 2, hair ? hair.mat.ramp[1] : lash);
  const mx = Math.round(cx + r * 0.55), my = Math.round(cy + r * 0.66);
  if (pose.shout) { b.set(mx, my, lash); b.set(mx - 1, my, lash); b.set(mx, my + 1, lash); }
  else b.set(mx, my, look.skin.ramp[1]);
  if (hair) hairFront(b, k, pose, hair.style, hair.mat, r);
}

function hairBack(b: PixelBuffer, k: Skeleton, pose: Pose, style: string, m: Material, r: number) {
  const [cx, cy] = k.headC, s = k.s, sw = pose.sway ?? 0;
  if (style === "ponytail") {
    let p: Pt = [cx - r * 0.7, cy - r * 0.55];
    for (let i = 0; i < 6; i++) {
      const q: Pt = [p[0] - 2.4 * s - sw * 1.2 * s, p[1] + 2.4 * s + Math.sin(i + sw * 2) * 0.6 * s];
      b.capsule(p[0], p[1], q[0], q[1], (2.6 - i * 0.28) * s, (2.3 - i * 0.28) * s, m);
      p = q;
    }
  } else if (style === "wild") {
    b.ellipse(cx - r * 0.45, cy + r * 0.3, r * 0.75, r * 1.05, m);
    for (let i = 0; i < 4; i++) b.capsule(cx - r * 0.4, cy, cx - r * (1.2 + i * 0.15) - sw * s, cy + r * (0.6 + i * 0.35), 2.4 * s, 0.6 * s, m);
  } else if (style === "hood") {
    b.ellipse(cx - r * 0.15, cy + r * 0.05, r * 1.25, r * 1.3, farSide(m));
  } else if (style === "bob") {
    b.ellipse(cx - r * 0.3, cy + r * 0.25, r * 0.85, r * 0.95, m);
  }
}

function hairFront(b: PixelBuffer, k: Skeleton, pose: Pose, style: string, m: Material, r: number) {
  const [cx, cy] = k.headC, s = k.s, sw = pose.sway ?? 0;
  const cap = () => b.poly([
    [cx - r * 1.0, cy + r * 0.1], [cx - r * 0.9, cy - r * 0.75], [cx - r * 0.2, cy - r * 1.12], [cx + r * 0.6, cy - r * 0.95],
    [cx + r * 1.0, cy - r * 0.35], [cx + r * 0.9, cy - r * 0.1], [cx + r * 0.55, cy - r * 0.35], [cx + r * 0.3, cy - r * 0.1],
    [cx, cy - r * 0.3], [cx - r * 0.25, cy + r * 0.1], [cx - r * 0.55, cy + r * 0.45],
  ], m);
  switch (style) {
    case "spiky": {
      cap();
      const spikes: [number, number, number][] = [[-0.2, -1.0, 150], [-0.6, -0.8, 205], [-0.9, -0.4, 235], [0.25, -1.05, 165], [-0.95, 0.1, 255], [0.75, -0.6, 125]];
      for (const [ox, oy, ang] of spikes) {
        const base: Pt = [cx + r * ox, cy + r * oy];
        const tip = add(base, dirOf(ang + sw * 6), r * 0.95);
        b.poly([add(base, dirOf(ang + 90), r * 0.38), tip, add(base, dirOf(ang - 90), r * 0.38)], m);
      }
      // bangs over the eye
      b.poly([[cx + r * 0.2, cy - r * 0.6], [cx + r * 1.05, cy - r * 0.3], [cx + r * 0.7, cy + r * 0.1], [cx + r * 0.55, cy - r * 0.15], [cx + r * 0.35, cy + r * 0.05]], m);
      break;
    }
    case "ponytail":
    case "bob":
      cap();
      b.poly([[cx + r * 0.1, cy - r * 0.7], [cx + r * 1.0, cy - r * 0.4], [cx + r * 0.95, cy + r * 0.05], [cx + r * 0.65, cy - r * 0.2], [cx + r * 0.45, cy + r * 0.15]], m);
      if (style === "bob") b.poly([[cx - r * 0.95, cy - r * 0.1], [cx - r * 0.3, cy], [cx - r * 0.25, cy + r * 1.05], [cx - r * 0.95, cy + r * 0.9]], m);
      if (style === "ponytail") b.ellipse(cx - r * 0.75, cy - r * 0.55, 1.6 * s, 1.6 * s, m, { bias: 0.2 });
      break;
    case "wild": {
      cap();
      for (const [ox, oy, ang, len] of [[-0.3, -1.0, 170, 1.1], [0.3, -1.0, 140, 1.0], [-0.8, -0.6, 210, 1.2], [0.8, -0.5, 110, 0.8]] as const) {
        const base: Pt = [cx + r * ox, cy + r * oy];
        b.poly([add(base, dirOf(ang + 90), r * 0.4), add(base, dirOf(ang + sw * 8), r * len), add(base, dirOf(ang - 90), r * 0.4)], m);
      }
      b.poly([[cx + r * 0.15, cy - r * 0.65], [cx + r * 1.1, cy - r * 0.2], [cx + r * 0.6, cy + r * 0.05], [cx + r * 0.4, cy + r * 0.2]], m);
      break;
    }
    case "slick":
      b.poly([[cx - r * 1.0, cy + r * 0.2], [cx - r * 0.95, cy - r * 0.7], [cx - r * 0.1, cy - r * 1.12], [cx + r * 0.7, cy - r * 0.9], [cx + r * 0.95, cy - r * 0.45], [cx + r * 0.25, cy - r * 0.45], [cx - r * 0.35, cy + r * 0.1]], m);
      b.capsule(cx - r * 0.8, cy - r * 0.6, cx - r * 1.5 - sw * s, cy - r * 0.2, 1.8 * s, 0.6 * s, m);
      break;
    case "topknot":
      b.poly([[cx - r * 0.95, cy + r * 0.1], [cx - r * 0.85, cy - r * 0.75], [cx, cy - r * 1.05], [cx + r * 0.8, cy - r * 0.75], [cx + r * 0.5, cy - r * 0.45], [cx - r * 0.3, cy - r * 0.2], [cx - r * 0.5, cy + r * 0.35]], m);
      b.ellipse(cx - r * 0.25, cy - r * 1.25, 2.2 * s, 2 * s, m, { bias: 0.15 });
      b.capsule(cx - r * 0.5, cy - r * 1.3, cx - r * 1.4 - sw * s, cy - r * 0.9, 1.5 * s, 0.7 * s, m);
      break;
    case "hood":
      b.poly([[cx - r * 1.25, cy + r * 0.9], [cx - r * 1.2, cy - r * 0.6], [cx - r * 0.2, cy - r * 1.35], [cx + r * 0.85, cy - r * 0.95], [cx + r * 1.05, cy - r * 0.2], [cx + r * 0.55, cy - r * 0.55], [cx + r * 0.05, cy - r * 0.5], [cx - r * 0.35, cy + r * 0.3], [cx - r * 0.5, cy + r * 1.05]], m);
      break;
  }
}

// ── weapons ───────────────────────────────────────────────────────────────────
function drawWeapon(b: PixelBuffer, k: Skeleton, look: HumanoidLook, pose: Pose, side: "front" | "back") {
  const s = k.s;
  const metal = look.weaponMat, accent = look.weaponAccent ?? metal, glow = look.weaponGlow;
  if (!metal) return;
  const hand = side === "front" ? k.fHand : k.bHand;
  const fd = side === "front" ? k.foreDir : k.bForeDir;
  const baseAng = Math.atan2(fd[0], fd[1]) * 180 / Math.PI;
  const ang = baseAng + (pose.wpn ?? 0);
  const d = dirOf(ang);
  switch (look.weapon) {
    case "katana": {
      const hiltEnd = add(hand, d, -4.5 * s), guard = add(hand, d, 2.2 * s), tip = add(guard, d, 26 * s);
      b.capsule(...hiltEnd, ...guard, 1.1 * s, 1.1 * s, accent!);
      b.ellipse(guard[0], guard[1], 1.9 * s, 1.9 * s, look.weaponAccent ?? metal);
      bladeLine(b, guard, tip, add(tip, dirOf(ang + 90), 1.2 * s), metal, s, 1.15);
      break;
    }
    case "greatsword": {
      const pommel = add(hand, d, -8 * s), guard = add(hand, d, 3 * s), tip = add(guard, d, 30 * s);
      b.capsule(...pommel, ...guard, 1.3 * s, 1.3 * s, accent!);
      b.capsule(...add(guard, dirOf(ang + 90), 4 * s), ...add(guard, dirOf(ang - 90), 4 * s), 1.4 * s, 1.4 * s, accent!);
      b.poly([add(guard, dirOf(ang + 90), 2.6 * s), add(tip, dirOf(ang + 90), 1.4 * s), add(tip, d, 3 * s), add(tip, dirOf(ang - 90), 1.4 * s), add(guard, dirOf(ang - 90), 2.6 * s)], metal);
      b.line(...add(guard, d, 1 * s), ...add(tip, d, -1 * s), metal.ramp[4]);
      if (glow) b.line(...add(add(guard, d, 3 * s), dirOf(ang + 90), 1 * s), ...add(add(tip, d, -3 * s), dirOf(ang + 90), 1 * s), glow.ramp[3]);
      break;
    }
    case "spear": {
      const butt = add(hand, d, -22 * s), head = add(hand, d, 18 * s), tip = add(head, d, 9 * s);
      b.capsule(...butt, ...head, 1.1 * s, 1.1 * s, accent!);
      b.poly([add(head, dirOf(ang + 90), 2.6 * s), tip, add(head, dirOf(ang - 90), 2.6 * s), add(head, d, -2 * s)], metal);
      if (glow) { // a tassel under the spearhead
        const bt = add(head, d, -2 * s);
        const hang = add(bt, [-(pose.sway ?? 0) * 0.4, 1], 6 * s);
        b.capsule(bt[0], bt[1], hang[0], hang[1], 1.6 * s, 0.6 * s, glow, { rim: false });
      }
      break;
    }
    case "staff": {
      const butt = add(hand, d, -20 * s), top = add(hand, d, 20 * s);
      b.capsule(...butt, ...top, 1.2 * s, 1.3 * s, accent!);
      b.capsule(...add(top, d, -1 * s), ...add(top, d, 3 * s), 2.6 * s, 2.2 * s, accent!);
      if (glow) {
        const orb = add(top, d, 5 * s);
        b.ellipse(orb[0], orb[1], (3.4 + (pose.glow ?? 0) * 1.5) * s, (3.4 + (pose.glow ?? 0) * 1.5) * s, glow);
      }
      break;
    }
    case "daggers": {
      const guard = add(hand, d, 1.5 * s), tip = add(guard, d, 11 * s);
      b.capsule(...add(hand, d, -2.5 * s), ...guard, 1 * s, 1 * s, accent!);
      b.capsule(...add(guard, dirOf(ang + 90), 2 * s), ...add(guard, dirOf(ang - 90), 2 * s), 0.8 * s, 0.8 * s, accent!);
      bladeLine(b, guard, tip, add(tip, dirOf(ang + 90), 0.6 * s), metal, s, 1.0);
      break;
    }
    case "axe": {
      const butt = add(hand, d, -14 * s), top = add(hand, d, 24 * s);
      b.capsule(...butt, ...top, 1.6 * s, 1.6 * s, accent!);
      const hd = add(top, d, -4 * s), side2 = dirOf(ang + 90);
      b.poly([add(hd, d, 4 * s), add(add(hd, side2, 10 * s), d, 7 * s), add(add(hd, side2, 12 * s), d, -2 * s), add(add(hd, side2, 9 * s), d, -9 * s), add(hd, d, -5 * s)], metal);
      b.poly([add(hd, d, 3 * s), add(add(hd, side2, -5 * s), d, 5 * s), add(add(hd, side2, -5 * s), d, -5 * s), add(hd, d, -4 * s)], metal);
      break;
    }
    case "club": {
      const butt = add(hand, d, -8 * s), top = add(hand, d, 30 * s);
      b.capsule(...butt, ...top, 1.8 * s, 4.6 * s, accent!);
      for (let i = 0; i < 5; i++) {
        const p = lerpPt(hand, top, 0.45 + i * 0.13);
        const sp = add(p, dirOf(ang + (i % 2 ? 90 : -90)), (2.6 + i * 0.5) * s);
        b.ellipse(sp[0], sp[1], 1.3 * s, 1.3 * s, metal);
      }
      break;
    }
    case "claws": {
      for (let i = -1; i <= 1; i++) {
        const base = add(hand, dirOf(ang + 90), i * 1.6 * s);
        const tip = add(add(base, d, 8 * s), dirOf(ang + 90), i * 1.5 * s + 1.5 * s);
        b.capsule(base[0], base[1], tip[0], tip[1], 1 * s, 0.3 * s, metal);
      }
      break;
    }
    case "boulder": {
      const c = add(hand, dirOf(ang), 5 * s);
      b.ellipse(c[0], c[1], 9 * s, 8 * s, metal);
      b.ellipse(c[0] + 2 * s, c[1] - 2 * s, 3 * s, 2 * s, metal, { bias: 0.25, clip: true });
      break;
    }
    case "gauntlets":
    case "none":
      break;
  }
}

/** A blade with a bright edge line along one side. */
function bladeLine(b: PixelBuffer, from: Pt, to: Pt, toSide: Pt, metal: Material, s: number, w: number) {
  b.capsule(from[0], from[1], to[0], to[1], w * s, 0.3 * s, metal, { bias: 0.25 });
  b.line(from[0], from[1], toSide[0], toSide[1], metal.ramp[4]);
}
