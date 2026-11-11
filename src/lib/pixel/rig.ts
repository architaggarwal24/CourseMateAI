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
import { farSide, hex, type Material } from "./color";

const WHITE = hex("#f8f6ff"), SCLERA = hex("#e9e6f5");

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
  /** A chain whip's lash (0 hanging .. 1 streaming out along the swing). */
  lash?: number;
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

export type WeaponKind = "katana" | "spear" | "staff" | "daggers" | "greatsword" | "gauntlets" | "axe" | "club" | "claws" | "boulder" | "none"
  // your hero's original styles: a short sword with a buckler, a chain whip, a war fan, twin kamas
  | "sword" | "whip" | "fan" | "kamas";

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
  /** A worn head piece (champion skins: circlet, helm, hood, crown, horns). */
  headgear?: HeadPiece;
  /** Edging on hems, cuffs, collars and the cape's border. */
  trim?: Material;
}

/** A pixel head piece drawn over a hero's head. Sized from the head radius, so it fits every champion. */
export interface HeadPiece {
  kind: "circlet" | "helm" | "hood" | "crown" | "horns";
  mat: Material;
  /** Gem, visor, crest or headband tails. */
  trim?: Material;
  /** circlet: a cloth headband with tails flying behind (instead of a metal band). */
  cloth?: boolean;
  /** hood: a tall pointed tip. */
  point?: boolean;
  /** hood: a veil over the mouth and nose. */
  mask?: boolean;
  /** helm: a pair of horns on it. */
  horns?: Material;
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
  if (look.weapon === "daggers" || look.weapon === "kamas") drawWeapon(b, k, look, pose, "back");
  drawArm(b, k, look, "back", far);
  if (look.weapon === "sword") drawBuckler(b, k, look);
  drawLeg(b, k, look, "back", far);
  if (look.coat && look.coatLen) drawCoatTail(b, k, look.coat, look.coatLen * s, sway, true, look.trim);

  // 2 ─ body
  drawTorso(b, k, look, B);
  drawLeg(b, k, look, "front", (m) => m);
  if (look.topStyle === "robe" && look.coat) drawRobeSkirt(b, k, look.coat, look, sway);
  if (look.coat && look.coatLen) drawCoatTail(b, k, look.coat, look.coatLen * s, sway, false, look.trim);
  if (look.belt) drawBelt(b, k, look.belt, B, s, look.topStyle === "armor" || look.topStyle === "jacket");
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
  torsoDetail(b, k, look, B, bodyMat);
}

/** Folds, seams, plates and trims on the torso, drawn inside the cloth they belong to. */
function torsoDetail(b: PixelBuffer, k: Skeleton, look: HumanoidLook, B: Build, bodyMat: Material) {
  const s = k.s, { hip, chest, up, fwd } = k;
  const sw = B.shoulderW * s / 2, ww = B.waistW * s / 2;
  const waist = add(hip, up, B.torso * s * 0.42);
  const fold = bodyMat.ramp[1], deep = bodyMat.ramp[0], lit = bodyMat.ramp[3];
  const L = (a: Pt, c: Pt, col: number, on = bodyMat) => b.lineOn(a[0], a[1], c[0], c[1], col, on);
  switch (look.topStyle) {
    case "coat": {
      // creases pulled from the armpit to the waist, and a lit edge down the open front
      L(add(add(chest, up, -3 * s), fwd, -sw * 0.55), add(add(waist, up, -1 * s), fwd, -ww * 0.3), fold);
      L(add(add(chest, up, -6 * s), fwd, -sw * 0.2), add(add(waist, up, 1 * s), fwd, -ww * 0.05), fold);
      L(add(add(chest, up, 0.5 * s), fwd, sw * 0.22), add(add(waist, up, -2 * s), fwd, ww * 0.02), lit);
      if (look.trim) b.capsule(...add(chest, fwd, -sw * 0.55), ...add(add(chest, fwd, sw * 0.28), up, 2.4 * s), 0.8 * s, 0.6 * s, look.trim, { on: look.coat, noRimLight: true });
      break;
    }
    case "gi": {
      L(add(add(chest, up, -9 * s), fwd, -sw * 0.6), add(add(waist, up, -1 * s), fwd, ww * 0.4), fold);
      L(add(add(chest, up, -3 * s), fwd, -sw * 0.75), add(add(chest, up, -7 * s), fwd, -sw * 0.1), fold);
      if (look.trim) L(add(add(chest, up, 1 * s), fwd, sw * 0.65), add(add(chest, up, -8 * s), fwd, -sw * 0.1), look.trim.ramp[2]);
      break;
    }
    case "armor": {
      // a breastplate ridge, two belly plates and rivets that catch the light
      for (const t of [0.15, 0.32]) {
        const c = add(hip, up, B.torso * s * (0.42 + t));
        L(add(c, fwd, -ww * 0.9), add(c, fwd, ww * 1.0), deep);
        L(add(add(c, fwd, -ww * 0.8), up, 1 * s), add(add(c, fwd, ww * 0.9), up, 1 * s), lit);
      }
      const r1 = add(add(chest, up, -2 * s), fwd, sw * 0.65), r2 = add(add(chest, up, -2 * s), fwd, -sw * 0.55);
      b.dotOn(r1[0], r1[1], bodyMat.ramp[4], bodyMat); b.dotOn(r2[0], r2[1], bodyMat.ramp[4], bodyMat);
      if (look.trim) L(add(add(chest, up, 1.2 * s), fwd, -sw * 0.5), add(add(chest, up, 1.6 * s), fwd, sw * 0.6), look.trim.ramp[2]);
      break;
    }
    case "robe": {
      L(add(add(chest, up, -2 * s), fwd, -sw * 0.5), add(waist, fwd, -ww * 0.5), fold);
      if (look.trim) {
        const n = add(chest, up, 1 * s);
        L(add(n, fwd, sw * 0.55), add(add(chest, up, -7 * s), fwd, sw * 0.05), look.trim.ramp[2]);
        L(add(n, fwd, -sw * 0.2), add(add(chest, up, -7 * s), fwd, sw * 0.05), look.trim.ramp[1]);
      }
      break;
    }
    case "jacket": {
      L(add(add(chest, up, -4 * s), fwd, -sw * 0.7), add(add(waist, up, -2 * s), fwd, -ww * 0.2), fold);
      const pk = add(add(waist, up, -1.5 * s), fwd, -ww * 0.55);
      L(pk, add(pk, fwd, ww * 0.6), deep);
      if (look.trim) L(add(add(waist, up, -3.5 * s), fwd, -ww * 1.1), add(add(waist, up, -3.5 * s), fwd, ww * 1.1), look.trim.ramp[2]);
      break;
    }
    case "tank":
    case "bare": {
      // collarbone + abs
      L(add(add(chest, up, -1 * s), fwd, -sw * 0.2), add(add(chest, up, -1.5 * s), fwd, sw * 0.5), fold);
      L(add(add(chest, up, -9 * s), fwd, sw * 0.2), add(add(waist, up, -1 * s), fwd, sw * 0.2), fold);
      break;
    }
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
  const kd = side === "front" ? k.foreDir : k.bForeDir;
  const perp: Pt = [kd[1], -kd[0]];
  // a sleeve fold at the elbow
  const um = look.sleeves === "none" ? undefined : f(upperM);
  if (um) b.capsule(...lerpPt(sh, el, 0.82), ...lerpPt(el, ha, 0.12), B.armR * s * 0.5, B.armR * s * 0.4, um, { on: um, flat: 1, noRimLight: true });
  if (look.gloves) {
    const g = f(look.gloves);
    b.capsule(...lerpPt(el, ha, 0.45), ha[0], ha[1], B.foreR * s * 1.1, B.foreR * s * 0.95, g);
    b.capsule(...lerpPt(el, ha, 0.42), ...lerpPt(el, ha, 0.5), B.foreR * s * 1.18, B.foreR * s * 1.12, g, { bias: 0.2 });
  } else if (look.sleeves === "long") b.capsule(...lerpPt(el, ha, 0.8), ...lerpPt(el, ha, 0.9), B.foreR * s * 1.2, B.foreR * s * 1.2, f(look.trim ?? sleeveMat(look)));
  const gauntlet = look.weapon === "gauntlets" && look.weaponMat;
  const handMat = f(gauntlet ? look.weaponMat! : look.gloves ?? look.skin);
  b.ellipse(ha[0], ha[1], B.handR * s * (gauntlet ? 1.35 : 1), B.handR * s * (gauntlet ? 1.25 : 0.95), handMat);
  if (!gauntlet) {
    // thumb on top, the curled fingers split by a crease, a lit knuckle
    const th = add(add(ha, perp, B.handR * s * 0.75), kd, -B.handR * s * 0.1);
    b.ellipse(th[0], th[1], 1.1 * s, 1.2 * s, handMat, { noRimLight: true });
    const kc = add(ha, kd, B.handR * s * 0.3);
    b.lineOn(...add(kc, perp, -B.handR * s * 0.9), ...add(kc, perp, B.handR * s * 0.4), handMat.ramp[1], handMat);
    const kn = add(add(ha, kd, B.handR * s * 0.7), perp, B.handR * s * 0.3);
    b.dotOn(kn[0], kn[1], handMat.ramp[3], handMat);
  } else {
    const kc = add(ha, kd, B.handR * s * 0.4);
    b.lineOn(...add(kc, perp, -B.handR * s * 1.2), ...add(kc, perp, B.handR * s * 1.2), handMat.ramp[1], handMat);
  }
  if (gauntlet && look.weaponGlow) {
    // knuckle studs light up in the glow colour
    const kn = add(ha, kd, B.handR * s * 0.75);
    b.set(Math.round(kn[0]), Math.round(kn[1]), look.weaponGlow.ramp[3]);
    b.set(Math.round(kn[0] + kd[1]), Math.round(kn[1] - kd[0]), look.weaponGlow.ramp[2]);
  }
}

function drawLeg(b: PixelBuffer, k: Skeleton, look: HumanoidLook, side: "front" | "back", f: (m: Material) => Material) {
  const s = k.s, B = look.build;
  const [hp, kn, an] = side === "front" ? [k.fHip, k.fKnee, k.fAnkle] : [k.bHip, k.bKnee, k.bAnkle];
  const bag = look.baggy ? 1.3 : 1;
  b.capsule(hp[0], hp[1], kn[0], kn[1], B.thighR * s * bag, B.shinR * s * 1.15 * bag, f(look.pants));
  const bootTop = lerpPt(kn, an, look.baggy ? 0.62 : 0.4);
  b.capsule(kn[0], kn[1], ...bootTop, B.shinR * s * 1.1 * bag, B.shinR * s * bag, f(look.pants));
  const pm = f(look.pants), bm = f(look.boots);
  // folds: a crease behind the knee, a pull line down the thigh (baggy trousers bunch more)
  const thighDir = norm([kn[0] - hp[0], kn[1] - hp[1]]), tp: Pt = [-thighDir[1], thighDir[0]];
  b.lineOn(...add(lerpPt(hp, kn, 0.3), tp, -B.thighR * s * 0.3), ...add(lerpPt(hp, kn, 0.85), tp, -B.thighR * s * 0.1), pm.ramp[1], pm);
  b.lineOn(...add(kn, tp, -B.shinR * s * 0.9), ...add(kn, tp, B.shinR * s * 0.2), pm.ramp[1], pm);
  if (look.baggy) {
    const lo = lerpPt(kn, an, 0.5);
    b.lineOn(...add(lo, tp, -B.shinR * s * 1.2), ...add(add(lo, tp, B.shinR * s), thighDir, 2 * s), pm.ramp[1], pm);
  }
  b.capsule(...bootTop, an[0], an[1], B.shinR * s * 1.05, B.shinR * s * 0.9, bm);
  // boot cuff
  b.capsule(...lerpPt(bootTop, an, -0.05), ...lerpPt(bootTop, an, 0.14), B.shinR * s * 1.22, B.shinR * s * 1.15, bm, { bias: 0.18 });
  const toe: Pt = [an[0] + B.foot * s, an[1] + 1.2 * s];
  b.capsule(an[0] - 1 * s, an[1] + 0.3 * s, toe[0], toe[1], 2.2 * s, 1.5 * s, bm);
  // the sole: a dark strip under the foot, a lit toe cap
  b.lineOn(an[0] - 2 * s, an[1] + 2.4 * s, toe[0] + 1 * s, toe[1] + 1.2 * s, bm.ramp[0], bm);
  b.dotOn(toe[0] - 0.5 * s, toe[1] - 0.8 * s, bm.ramp[3], bm);
}

const norm = (v: Pt): Pt => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

function drawCoatTail(b: PixelBuffer, k: Skeleton, m: Material, len: number, sway: number, back: boolean, trim?: Material) {
  const s = k.s;
  const base = add(k.hip, k.up, 4 * s);
  const flare = 2.5 * s + Math.abs(sway) * 2 * s;
  const off = back ? -1 : 1;
  const top: Pt = add(base, k.fwd, off * (back ? 5.5 : 4.5) * s);
  const top2: Pt = add(base, k.fwd, off * 1 * s);
  const bx = -sway * 4 * s - (back ? 3 : 0) * s;
  const bottom: Pt = [top[0] + off * flare + bx, base[1] + len];
  const bottom2: Pt = [top2[0] + bx * 0.6 + off * 0.5 * s, base[1] + len - 2 * s];
  const mm = back ? farSide(m) : m;
  b.poly([top, top2, bottom2, bottom], mm);
  const mid = lerpPt(top, top2, 0.5), midB = lerpPt(bottom, bottom2, 0.45);
  b.lineOn(mid[0], mid[1] + 2 * s, midB[0], midB[1] - 1 * s, mm.ramp[1], mm);
  if (!back) b.lineOn(top2[0], top2[1] + 1 * s, bottom2[0], bottom2[1] - 1 * s, mm.ramp[3], mm);
  if (trim) b.capsule(bottom[0], bottom[1] - 1 * s, bottom2[0], bottom2[1] - 1 * s, 0.9 * s, 0.9 * s, trim, { on: mm, noRimLight: true });
}

function drawRobeSkirt(b: PixelBuffer, k: Skeleton, m: Material, look: HumanoidLook, sway: number) {
  const s = k.s;
  const base = add(k.hip, k.up, 3 * s);
  const groundY = Math.max(k.fAnkle[1], k.bAnkle[1]) - 1 * s;
  const sx = -sway * 3 * s;
  const hemF: Pt = [k.fAnkle[0] + 4 * s + sx, groundY], hemB: Pt = [k.bAnkle[0] - 5 * s + sx * 1.3, groundY];
  // the hem ripples: a few points along the bottom edge rise and fall with the sway
  const hem: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const p = lerpPt(hemF, hemB, t);
    hem.push([p[0], p[1] + Math.sin(t * Math.PI * 2 + sway * 2.4) * 0.9 * s + (i === 3 ? 1 * s : 0)]);
  }
  const top0 = add(base, k.fwd, -6 * s), top1 = add(base, k.fwd, 6 * s);
  b.poly([top0, top1, ...hem], m);
  // folds fanning from the waist to the hem; the one in the light gets a bright edge
  for (const [t, c] of [[0.2, m.ramp[3]], [0.45, m.ramp[1]], [0.72, m.ramp[1]], [0.88, m.ramp[0]]] as const) {
    const a = lerpPt(top1, top0, 0.15 + t * 0.7), z = lerpPt(hemF, hemB, t);
    b.lineOn(a[0], a[1] + 4 * s, z[0], z[1] - 2 * s, c, m);
  }
  if (look.trim) {
    for (let i = 0; i < hem.length - 1; i++) {
      b.capsule(hem[i][0], hem[i][1] - 1.4 * s, hem[i + 1][0], hem[i + 1][1] - 1.4 * s, 0.9 * s, 0.9 * s, look.trim, { on: m, noRimLight: true });
    }
  }
}

function drawBelt(b: PixelBuffer, k: Skeleton, m: Material, B: Build, s: number, buckle = false) {
  const w = add(k.hip, k.up, 3.2 * s);
  b.capsule(...add(w, k.fwd, -B.hipW * s * 0.5), ...add(w, k.fwd, B.hipW * s * 0.5), 1.4 * s, 1.4 * s, m, { rim: false });
  // knot tails
  const kn = add(w, k.fwd, B.hipW * s * 0.25);
  if (buckle) {
    b.ellipse(kn[0] + 0.5 * s, kn[1], 1.5 * s, 1.5 * s, BUCKLE);
    return;
  }
  b.capsule(kn[0], kn[1], kn[0] - 1 * s, kn[1] + 6 * s, 1.2 * s, 0.8 * s, m);
  b.capsule(kn[0] + 0.5 * s, kn[1], kn[0] + 1.8 * s, kn[1] + 4.5 * s, 1 * s, 0.7 * s, m);
  b.ellipse(kn[0], kn[1], 1.4 * s, 1.3 * s, m, { bias: 0.15 });
}

const BUCKLE: Material = { ramp: [hex("#5c3a0c"), hex("#a8741c"), hex("#d9ab30"), hex("#f5d36b"), hex("#fff4c2")], shiny: true };

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
  const cm = farSide(m);
  const hemF: Pt = [c[0] - 4 * s + sx, groundY], hemB: Pt = [a[0] - 12 * s + sx * 1.4, groundY + 2 * s];
  // the trailing hem waves; the far end lags the most (follow-through)
  const hem: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, p = lerpPt(hemF, hemB, t);
    hem.push([p[0] - t * t * sway * 3 * s, p[1] + Math.sin(t * Math.PI * 2.2 + sway * 3) * 1.6 * s * t]);
  }
  // the inside of the cape shows along the back edge, one shade darker
  b.poly([a, [a[0] - 2.5 * s, a[1] + 6 * s], [hemB[0] - 2 * s, hemB[1] - 3 * s], hem[6]], farSide(cm));
  b.poly([a, c, ...hem], cm);
  for (const t of [0.3, 0.55, 0.8]) {
    const top = lerpPt(c, a, t * 0.8), z = lerpPt(hemF, hemB, t);
    b.lineOn(top[0], top[1] + 5 * s, z[0] - t * sway * 2 * s, z[1] - 1 * s, cm.ramp[0], cm);
    b.lineOn(top[0] + 1, top[1] + 7 * s, z[0] + 1 - t * sway * 2 * s, z[1] - 2 * s, cm.ramp[2], cm);
  }
  if (look.trim) for (let i = 0; i < hem.length - 1; i++) b.capsule(hem[i][0], hem[i][1] - 1.2 * s, hem[i + 1][0], hem[i + 1][1] - 1.2 * s, 0.8 * s, 0.8 * s, look.trim, { on: cm, noRimLight: true });
}

// ── hero heads ────────────────────────────────────────────────────────────────
/** A hero's head (hair, face, head piece) on a skeleton's neck and head centre. Exported for item icons. */
export function drawHeroHead(b: PixelBuffer, k: Skeleton, pose: Pose, look: HumanoidLook) {
  const s = k.s, r = look.build.headR * s;
  const [cx, cy] = k.headC;
  const hair = look.hair;
  const tilt = rad((pose.head ?? 0) * 0.5);
  const piece = look.headgear;
  // a hood piece on a champion who already wears a hood (Mira) recolours that hood instead of doubling it
  const ownHood = hair?.style === "hood";
  const hairMat = ownHood && piece?.kind === "hood" ? piece.mat : hair?.mat;
  // hair behind the head (long styles)
  if (hair && hairMat) hairBack(b, k, pose, hair.style, hairMat, r);
  if (piece?.kind === "hood" && !ownHood) b.ellipse(cx - r * 0.15, cy + r * 0.05, r * 1.25, r * 1.3, farSide(piece.mat));
  // neck, shaded under the jaw
  b.capsule(k.neck[0], k.neck[1] + 1.5 * s, cx - 0.5 * s, cy + r * 0.4, 2 * s, 1.9 * s, look.skin, { bias: -0.35 });
  // skull + jaw (the face points forward: jaw pushed to +x)
  b.ellipse(cx, cy, r * 0.9, r, look.skin, {}, tilt);
  b.poly([[cx - r * 0.35, cy + r * 0.2], [cx + r * 0.85, cy + r * 0.15], [cx + r * 0.55, cy + r * 0.8], [cx + r * 0.05, cy + r * 1.02], [cx - r * 0.45, cy + r * 0.7]], look.skin, { rim: false, noRimLight: true });
  // jaw shadow along the bottom of the face, a nose that breaks the profile
  b.lineOn(cx - r * 0.35, cy + r * 0.78, cx + r * 0.25, cy + r * 0.98, look.skin.ramp[1], look.skin);
  b.ellipse(cx + r * 0.92, cy + r * 0.36, 0.8 * s, 1 * s, look.skin, { rim: false, noRimLight: true, bias: 0.1 });
  b.dotOn(Math.round(cx + r * 0.84), Math.round(cy + r * 0.5), look.skin.ramp[1], look.skin);
  // ear with its inner shadow
  b.ellipse(cx - r * 0.12, cy + r * 0.15, 1.3 * s, 1.8 * s, look.skin, { bias: -0.1, noRimLight: true });
  b.dotOn(Math.round(cx - r * 0.1), Math.round(cy + r * 0.18), look.skin.ramp[1], look.skin);
  // eye: anime style - a heavy upper lash with a flick at the outer corner, a two-tone iris, a white glint,
  // a sliver of white toward the nose, a soft lower lid
  const ex = Math.round(cx + r * 0.5), ey = Math.round(cy + r * 0.1);
  const lash = look.skin.ramp[0];
  const lid = look.skin.ramp[1];
  const brow = hair ? hair.mat.ramp[0] : lash;
  const state = pose.eyes ?? "open";
  if (state === "closed") {
    b.set(ex - 2, ey, lash); b.set(ex - 1, ey + 1, lash); b.set(ex, ey + 1, lash); b.set(ex + 1, ey + 1, lash); b.set(ex + 2, ey, lash);
    b.set(ex - 1, ey - 2, brow); b.set(ex, ey - 2, brow); b.set(ex + 1, ey - 2, brow);
  } else if (state === "hurt") {
    // squeezed shut: a ">" with the brow pulled up
    b.set(ex - 1, ey - 1, lash); b.set(ex, ey, lash); b.set(ex + 1, ey + 1, lash); b.set(ex, ey + 2, lash); b.set(ex - 1, ey + 2, lash);
    b.set(ex - 1, ey - 3, brow); b.set(ex, ey - 3, brow); b.set(ex + 1, ey - 2, brow);
  } else {
    const angry = state === "angry";
    // lash: thick, slanting down toward the nose when angry
    b.set(ex - 2, ey, lash); b.set(ex - 1, ey - 1, lash); b.set(ex, ey - 1, lash); b.set(ex + 1, ey - 1, lash);
    if (angry) b.set(ex + 1, ey, lash); else b.set(ex + 2, ey - 1, lash);
    // iris (2 x 2): dark under the lash, bright below; a glint top-front
    b.set(ex - 1, ey, look.eye.ramp[0]); b.set(ex, ey, WHITE);
    b.set(ex - 1, ey + 1, look.eye.ramp[2]); b.set(ex, ey + 1, look.eye.ramp[3]);
    if (!angry) b.set(ex + 1, ey, SCLERA);
    b.set(ex + 1, ey + 1, SCLERA);
    b.set(ex, ey + 2, lid);
    if (s >= 1.4) { b.set(ex - 2, ey + 1, look.eye.ramp[1]); b.set(ex - 1, ey + 2, lid); }
    // brow
    if (angry) { b.set(ex - 2, ey - 3, brow); b.set(ex - 1, ey - 3, brow); b.set(ex, ey - 2, brow); b.set(ex + 1, ey - 2, brow); }
    else { b.set(ex - 2, ey - 3, brow); b.set(ex - 1, ey - 3, brow); b.set(ex, ey - 3, brow); b.set(ex + 1, ey - 3, brow); }
  }
  // mouth: a short line, or open and shouting (dark, with a lit lower lip)
  const mx = Math.round(cx + r * 0.6), my = Math.round(cy + r * 0.68);
  if (pose.shout) {
    b.set(mx - 1, my, lash); b.set(mx, my, lash); b.set(mx - 1, my + 1, lash); b.set(mx, my + 1, hex("#b0404a"));
    b.set(mx, my + 2, look.skin.ramp[3]);
  } else { b.set(mx, my, look.skin.ramp[1]); b.set(mx - 1, my, look.skin.ramp[1]); }
  const covered = !ownHood && (piece?.kind === "hood" || piece?.kind === "helm");
  if (hair && hairMat && !covered) { hairFront(b, k, pose, hair.style, hairMat, r); hairShine(b, k, hair.style, hairMat, r); }
  if (piece) drawHeadPiece(b, k.headC, r, s, pose.sway ?? 0, piece, ownHood);
}

/**
 * A head piece around a head of radius `r` centred on `c` (the face looks toward +x). `onHood`: the wearer's own
 * hood is the outline of the head (Mira), so bands and crowns sit on the hood, a little bigger and higher.
 */
export function drawHeadPiece(b: PixelBuffer, c: Pt, r: number, s: number, sway: number, p: HeadPiece, onHood = false) {
  const [cx, cy] = c;
  const R = onHood ? r * 1.22 : r;
  const oy = onHood ? -r * 0.18 : 0;
  switch (p.kind) {
    case "circlet": {
      const back: Pt = [cx - R * 0.86, cy - R * 0.36 + oy], front: Pt = [cx + R * 0.8, cy - R * 0.52 + oy];
      if (p.cloth) {
        // two short tails knotted at the back, fluttering back and down
        for (const [base, len] of [[-58, 3], [-38, 2]] as const) {
          let q: Pt = [back[0] - 0.5 * s, back[1] + 0.4 * s];
          for (let i = 0; i < len; i++) {
            const n = add(q, dirOf(base + Math.sin(i * 1.7 + sway * 3) * 14 - sway * 10), 2.4 * s);
            b.capsule(q[0], q[1], n[0], n[1], (1.15 - i * 0.2) * s, (0.95 - i * 0.2) * s, p.trim ?? p.mat);
            q = n;
          }
        }
        b.capsule(...back, ...front, 1.25 * s, 1.1 * s, p.mat, { smooth: true });
        b.ellipse(back[0] + 0.4 * s, back[1] + 0.1 * s, 1.4 * s, 1.3 * s, p.trim ?? p.mat);
      } else {
        b.capsule(...back, ...front, 0.95 * s, 0.85 * s, p.mat, { smooth: true });
        if (p.trim) b.ellipse(front[0] - 0.8 * s, front[1] - 0.2 * s, 1.35 * s, 1.35 * s, p.trim);
      }
      break;
    }
    case "crown": {
      const y = cy - R * 0.78 + oy;
      const x0 = cx - R * 0.78, x1 = cx + R * 0.72;
      const pts = 4;
      for (let i = 0; i < pts; i++) {
        const x = x0 + ((x1 - x0) * (i + 0.5)) / pts, h = (i === 2 ? 4.4 : 3.4) * s;
        b.poly([[x - 1.7 * s, y + 0.6 * s], [x, y - h], [x + 1.7 * s, y + 0.6 * s]], p.mat);
      }
      b.capsule(x0, y + 0.8 * s, x1, y + 0.3 * s, 1.35 * s, 1.25 * s, p.mat, { smooth: true });
      if (p.trim) {
        b.ellipse(x0 + (x1 - x0) * 0.62, y + 0.5 * s, 1.1 * s, 1.1 * s, p.trim);
        b.set(Math.round(x0 + (x1 - x0) * 0.62), Math.round(y - 3.8 * s), p.trim.ramp[3]);
      }
      break;
    }
    case "helm": {
      // a dome over the skull with a brim over the brow and a neck guard behind
      b.poly([
        [cx - R * 1.12, cy + R * 0.55], [cx - R * 1.12, cy - R * 0.45], [cx - R * 0.55, cy - R * 1.08], [cx + R * 0.25, cy - R * 1.15],
        [cx + R * 0.85, cy - R * 0.8], [cx + R * 1.12, cy - R * 0.25], [cx + R * 0.55, cy - R * 0.22], [cx - R * 0.15, cy - R * 0.1],
        [cx - R * 0.45, cy + R * 0.25], [cx - R * 0.6, cy + R * 0.6],
      ], p.mat);
      b.capsule(cx - R * 0.2, cy - R * 0.2, cx + R * 1.12, cy - R * 0.3, 0.9 * s, 0.9 * s, p.mat, { smooth: true, bias: 0.15 });
      if (p.trim) {
        // a crest along the top (or a glowing visor line)
        b.capsule(cx - R * 0.75, cy - R * 0.95, cx + R * 0.45, cy - R * 1.15, 1.2 * s, 0.9 * s, p.trim);
      }
      if (p.horns) drawHorns(b, cx, cy, R, s, p.horns);
      break;
    }
    case "horns":
      drawHorns(b, cx, cy, R, s, p.mat);
      break;
    case "hood": {
      if (!onHood) {
        b.poly([[cx - r * 1.25, cy + r * 0.9], [cx - r * 1.2, cy - r * 0.6], [cx - r * 0.2, cy - r * 1.35], [cx + r * 0.85, cy - r * 0.95], [cx + r * 1.05, cy - r * 0.2], [cx + r * 0.55, cy - r * 0.55], [cx + r * 0.05, cy - r * 0.5], [cx - r * 0.35, cy + r * 0.3], [cx - r * 0.5, cy + r * 1.05]], p.mat);
      }
      if (p.point) {
        const base: Pt = [cx - R * 0.55, cy - R * 1.05];
        b.poly([[base[0] - 2.6 * s, base[1] + 2 * s], [base[0] - 6 * s - sway * 1.5 * s, base[1] - 4.5 * s], [base[0] + 3 * s, base[1] + 0.2 * s]], p.mat);
      }
      if (p.mask) {
        b.poly([[cx + r * 0.05, cy + r * 0.35], [cx + r * 1.0, cy + r * 0.25], [cx + r * 0.75, cy + r * 0.95], [cx + r * 0.05, cy + r * 1.05], [cx - r * 0.3, cy + r * 0.7]], p.trim ?? farSide(p.mat));
      }
      break;
    }
  }
}

function drawHorns(b: PixelBuffer, cx: number, cy: number, R: number, s: number, m: Material) {
  // the far horn first (darker), then the near one: each a curved, tapering chain
  const horn = (start: Pt, dirs: number[], mat: Material) => {
    let p = start, w = 1.9 * s;
    for (const d of dirs) {
      const q = add(p, dirOf(d), 2.6 * s);
      b.capsule(p[0], p[1], q[0], q[1], w, w * 0.72, mat);
      p = q; w *= 0.72;
    }
  };
  horn([cx - R * 0.55, cy - R * 0.8], [200, 215, 235, 255], farSide(m));
  horn([cx + R * 0.25, cy - R * 0.92], [165, 155, 140, 120], m);
}

/** Strands (dark lines that follow the hair's flow) and a glossy band of light across the crown. */
function hairShine(b: PixelBuffer, k: Skeleton, style: string, m: Material, r: number) {
  const [cx, cy] = k.headC;
  const crown: Pt = [cx - r * 0.15, cy - r * 0.95];
  const strands: [number, number][] = style === "hood"
    ? [[0.75, -0.35], [-0.95, 0.6]]
    : style === "slick" ? [[0.6, -0.55], [-0.9, -0.2], [-0.4, -0.7]]
    : [[0.85, -0.2], [0.45, -0.05], [-0.85, 0.25], [-0.55, -0.55], [0.15, -0.55]];
  for (const [tx, ty] of strands) b.lineOn(crown[0], crown[1] + 1, cx + r * tx, cy + r * ty, m.ramp[1], m);
  // the sheen: an arc of light over the upper-left of the head, brightest in the middle
  const c0: Pt = [cx - r * 0.05, cy - r * 0.05], R = r * (style === "hood" ? 0.95 : 0.78);
  for (let a = 200; a <= 285; a += 6) {
    const t = (a - 200) / 85, p: Pt = [c0[0] + Math.cos(rad(a)) * R, c0[1] + Math.sin(rad(a)) * R];
    const col = t > 0.3 && t < 0.7 ? m.ramp[4] : m.ramp[3];
    b.dotOn(p[0], p[1], col, m);
    if (t > 0.15 && t < 0.85) b.dotOn(p[0] + 0.8, p[1] + 1.1, m.ramp[3], m);
  }
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
      if (glow) b.line(...add(guard, d, 2 * s), ...add(tip, d, -2 * s), glow.ramp[3]);
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
      if (glow) b.line(...add(guard, d, 1.5 * s), ...add(tip, d, -1.5 * s), glow.ramp[3]);
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
    case "sword": {
      // a short arming sword: round pommel, a straight crossguard, a broad straight blade with a fuller
      const pommel = add(hand, d, -4 * s), guard = add(hand, d, 2 * s), tip = add(guard, d, 18 * s);
      b.capsule(...pommel, ...guard, 1.1 * s, 1.1 * s, accent!);
      b.ellipse(pommel[0], pommel[1], 1.5 * s, 1.5 * s, metal);
      b.capsule(...add(guard, dirOf(ang + 90), 3.2 * s), ...add(guard, dirOf(ang - 90), 3.2 * s), 1 * s, 1 * s, metal);
      b.poly([add(guard, dirOf(ang + 90), 1.6 * s), add(tip, dirOf(ang + 90), 1.1 * s), add(tip, d, 2.4 * s), add(tip, dirOf(ang - 90), 1.1 * s), add(guard, dirOf(ang - 90), 1.6 * s)], metal);
      b.lineOn(...add(guard, d, 1.5 * s), ...add(tip, d, -1 * s), metal.ramp[1], metal);
      b.line(...add(add(guard, d, 1 * s), dirOf(ang - 90), 1 * s), ...add(add(tip, d, -1 * s), dirOf(ang - 90), 0.6 * s), metal.ramp[4]);
      if (glow) b.line(...add(add(guard, d, 2 * s), dirOf(ang + 90), 0.8 * s), ...add(add(tip, d, -2 * s), dirOf(ang + 90), 0.6 * s), glow.ramp[3]);
      break;
    }
    case "whip": {
      // a wrapped grip, then a chain of links: it hangs when still and streams out along a lash
      const grip = add(hand, d, 3 * s);
      b.capsule(...add(hand, d, -3 * s), ...grip, 1.2 * s, 1.2 * s, accent!);
      const reach = Math.max(0, Math.min(1, pose.lash ?? 0));
      let p0: Pt = grip, a = ang;
      for (let i = 0; i < 12; i++) {
        // limp: each link turns toward hanging straight down; lashed out: it keeps the swing's line, flicking with the sway
        const target = reach > 0.5 ? ang + Math.sin(i * 0.6 + (pose.sway ?? 0) * 2) * 6 : 0;
        a += (target - a) * (reach > 0.5 ? 0.25 : 0.35);
        const q = add(p0, dirOf(a), 2.4 * s);
        b.ellipse(q[0], q[1], (i % 2 ? 0.9 : 1.2) * s, (i % 2 ? 0.9 : 1.2) * s, metal, { noRimLight: true });
        p0 = q;
      }
      b.poly([add(p0, dirOf(a + 90), 1.4 * s), add(p0, dirOf(a), 3.4 * s), add(p0, dirOf(a - 90), 1.4 * s)], glow ?? metal);
      break;
    }
    case "fan": {
      // a war fan, opened across the swing: steel ribs over painted silk, a tassel at the pivot
      const pivot = add(hand, d, 1.5 * s), open = 110, R = 10 * s;
      const rib = (t: number) => add(pivot, dirOf(ang - open / 2 + open * t), R);
      const silk: Pt[] = [pivot];
      for (let i = 0; i <= 8; i++) silk.push(rib(i / 8));
      b.poly(silk, accent!);
      for (let i = 0; i <= 8; i += 2) { const e = rib(i / 8); b.lineOn(pivot[0], pivot[1], e[0], e[1], accent!.ramp[1], accent!); }
      for (let i = 0; i < 8; i++) { const a0 = rib(i / 8), a1 = rib((i + 1) / 8); b.line(a0[0], a0[1], a1[0], a1[1], metal.ramp[3]); }
      b.capsule(...rib(0), ...pivot, 0.8 * s, 0.8 * s, metal);
      b.capsule(...rib(1), ...pivot, 0.8 * s, 0.8 * s, metal);
      b.ellipse(pivot[0], pivot[1], 1.2 * s, 1.2 * s, metal);
      const hang = add(pivot, [-(pose.sway ?? 0) * 0.3, 1], 4 * s);
      b.capsule(pivot[0], pivot[1], hang[0], hang[1], 0.8 * s, 0.4 * s, glow ?? accent!, { rim: false });
      break;
    }
    case "kamas": {
      // a sickle: a short wooden handle, the blade hooking out at a right angle, its inner edge sharp
      const top = add(hand, d, 5 * s);
      b.capsule(...add(hand, d, -3 * s), ...top, 1.1 * s, 1 * s, accent!);
      const out = dirOf(ang + 90);
      const tip = add(add(top, out, 8 * s), d, -2.5 * s);
      b.poly([add(top, d, 1 * s), add(add(top, out, 4 * s), d, 1.5 * s), tip, add(add(top, out, 3.5 * s), d, -0.5 * s), add(top, d, -1 * s)], metal, { bias: 0.15 });
      b.line(...add(add(top, out, 3.5 * s), d, -0.5 * s), ...tip, metal.ramp[4]);
      if (glow) b.set(Math.round(tip[0]), Math.round(tip[1]), glow.ramp[3]);
      break;
    }
    case "gauntlets":
    case "none":
      break;
  }
}

/** A round buckler strapped to the back forearm (the Apprentice Blade): boss, rim and a lit edge. */
function drawBuckler(b: PixelBuffer, k: Skeleton, look: HumanoidLook) {
  const s = k.s, c = lerpPt(k.bElbow, k.bHand, 0.65);
  const rimM = look.weaponMat ?? look.trim ?? look.boots, face = look.weaponAccent ?? look.top;
  b.ellipse(c[0], c[1], 5.6 * s, 5.6 * s, rimM);
  b.ellipse(c[0], c[1], 4.4 * s, 4.4 * s, face, { noRimLight: true });
  b.ellipse(c[0] - 0.3 * s, c[1] - 0.3 * s, 1.6 * s, 1.6 * s, rimM, { bias: 0.25 });
}

/**
 * A weapon on its own (item icons): held by an invisible hand at `hand`, pointing `deg` (rig angle: 0 = down,
 * 180 = up, 135 = up and forward). Gauntlets are drawn as a pair of armoured fists.
 */
export function drawWeaponAt(b: PixelBuffer, look: HumanoidLook, hand: Pt, deg: number, s = 1) {
  if (look.weapon === "gauntlets") {
    const m = look.weaponMat;
    if (!m) return;
    for (const [dx, dy, far] of [[-4, 2, true], [4, -2, false]] as const) {
      const c: Pt = [hand[0] + dx * s, hand[1] + dy * s];
      b.capsule(c[0] - 2.5 * s, c[1] + 4 * s, c[0], c[1], 3 * s, 3.4 * s, far ? farSide(m) : m);
      b.ellipse(c[0] + 0.5 * s, c[1] - 1 * s, 4.2 * s, 3.8 * s, far ? farSide(m) : m);
      if (look.weaponGlow) for (let i = -1; i <= 1; i++) b.set(Math.round(c[0] + 3 * s), Math.round(c[1] - 1 * s + i * 1.6 * s), look.weaponGlow.ramp[3]);
    }
    return;
  }
  const fd = dirOf(deg);
  const k = { fHand: hand, bHand: add(hand, [-3 * s, 2 * s]), foreDir: fd, bForeDir: dirOf(deg + 30), s } as unknown as Skeleton;
  drawWeapon(b, k, look, {}, "front");
  if (look.weapon === "daggers") {
    const k2 = { ...k, fHand: add(hand, [-6 * s, 4 * s]), foreDir: dirOf(deg - 25) } as Skeleton;
    drawWeapon(b, k2, look, {}, "front");
  }
}

/** A blade with a bright edge line along one side. */
function bladeLine(b: PixelBuffer, from: Pt, to: Pt, toSide: Pt, metal: Material, s: number, w: number) {
  b.capsule(from[0], from[1], to[0], to[1], w * s, 0.3 * s, metal, { bias: 0.25 });
  b.line(from[0], from[1], toSide[0], toSide[1], metal.ramp[4]);
}
