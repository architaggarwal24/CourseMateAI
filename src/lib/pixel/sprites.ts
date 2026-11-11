/**
 * Sprite frames: every (character, animation, frame) is rasterised ONCE into a PixelBuffer and cached. The scene
 * only blits cached frames, so drawing a fight costs a few image copies per frame.
 *
 * Swappable art: a PNG sprite sheet listed in /sprites/manifest.json replaces the hand-coded sprite of the same id
 * (see ./sheets.ts and docs/pixel-sprites.md). This module is the procedural source.
 */
import { PixelBuffer, type Pt } from "./buffer";
import { BOSS_ANIMS, BOSS_FRAME, type BossAnim, type BossDef } from "./bosses";
import { hex, unpack, type RGBA } from "./color";
import { HERO_IMPACT_FRAME, heroAnims, type AnimName, type HeroDef } from "./heroes";
import { dirOf, drawHumanoid, solve, type HumanoidLook, type Pose } from "./rig";

export interface Frame {
  buf: PixelBuffer;
  /** The ground point under the figure, in frame pixels. */
  anchor: Pt;
}

export const HERO_FRAME = { w: 176, h: 124, anchor: [100, 118] as Pt };
const OUTLINE = hex("#0b0a12");

const cache = new Map<string, Frame>();

/** Two looks of one hero (gear tints) are different frames: the key carries the look's signature colours. */
export const lookKey = (hero: HeroDef) => hero.skinKey ?? `${hero.id}:${hero.look.weaponGlow?.ramp[2] ?? ""}:${hero.look.top.ramp[2]}`;

export function heroFrame(hero: HeroDef, anim: AnimName, index: number, cacheKey = lookKey(hero)): Frame {
  const poses = heroAnims(hero.style)[anim];
  const i = ((index % poses.length) + poses.length) % poses.length;
  const key = `hero:${cacheKey}:${anim}:${i}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pose = poses[i];
  let buf = new PixelBuffer(HERO_FRAME.w, HERO_FRAME.h);
  drawHumanoid(buf, hero.look, pose, HERO_FRAME.anchor);
  buf.outline(OUTLINE);
  buf.glow(0.6 + Math.min(1, pose.glow ?? 0) * 0.4);
  if (anim === "attack" && i > 0 && i <= HERO_IMPACT_FRAME + 2) swing(buf, hero.look, poses[i - 1], pose);
  if (pose.fall) buf = buf.rotated(pose.fall, HERO_FRAME.anchor);
  const frame = { buf, anchor: HERO_FRAME.anchor };
  cache.set(key, frame);
  return frame;
}

// ── swing trails ─────────────────────────────────────────────────────────────
/** How far past the hand each weapon reaches (where its trail runs), and where the trail starts. */
const REACH: Partial<Record<HumanoidLook["weapon"], [number, number]>> = {
  katana: [10, 28], greatsword: [12, 33], spear: [16, 27], daggers: [4, 12], staff: [14, 25], axe: [14, 26], club: [10, 30], claws: [3, 9], gauntlets: [-1, 2], none: [-1, 2],
  sword: [6, 20], whip: [6, 32], fan: [3, 11], kamas: [3, 10],
};

function tipLine(look: HumanoidLook, pose: Pose): [[number, number], [number, number]] | null {
  const r = REACH[look.weapon];
  if (!r) return null;
  const k = solve(look.build, pose, HERO_FRAME.anchor, look.scale);
  const ang = Math.atan2(k.foreDir[0], k.foreDir[1]) * 180 / Math.PI + (look.weapon === "gauntlets" || look.weapon === "none" ? 0 : pose.wpn ?? 0);
  const d = dirOf(ang), s = look.scale;
  return [[k.fHand[0] + d[0] * r[0] * s, k.fHand[1] + d[1] * r[0] * s], [k.fHand[0] + d[0] * r[1] * s, k.fHand[1] + d[1] * r[1] * s]];
}

/**
 * A swing smear: the band the weapon swept through since the last frame, painted in fading translucent light
 * (brightest at the tip, at the newest edge). Only big, fast moves leave one.
 */
function swing(buf: PixelBuffer, look: HumanoidLook, prev: Pose, cur: Pose) {
  const a = tipLine(look, prev), b = tipLine(look, cur);
  if (!a || !b) return;
  const moved = Math.hypot(b[1][0] - a[1][0], b[1][1] - a[1][1]);
  if (moved < 9) return;
  const col = look.weaponGlow ? look.weaponGlow.ramp[3] : hex("#f2f6ff");
  const steps = Math.ceil(moved * 1.5);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;                                   // 0 = old position, 1 = now
    const base: [number, number] = [a[0][0] + (b[0][0] - a[0][0]) * t, a[0][1] + (b[0][1] - a[0][1]) * t];
    const tip: [number, number] = [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t];
    const len = Math.ceil(Math.hypot(tip[0] - base[0], tip[1] - base[1]));
    for (let j = 0; j <= len; j++) {
      const u = j / Math.max(1, len);                      // 0 = base, 1 = tip
      const alpha = Math.round(170 * t * t * (0.25 + 0.75 * u));
      if (alpha < 18) continue;
      blend(buf, Math.round(base[0] + (tip[0] - base[0]) * u), Math.round(base[1] + (tip[1] - base[1]) * u), u > 0.85 && t > 0.7 ? hex("#ffffff") : col, alpha);
    }
  }
}

/** Paint `c` at alpha `a` over whatever is there (transparent pixels just take the translucent colour). */
function blend(buf: PixelBuffer, x: number, y: number, c: RGBA, a: number) {
  if (x < 0 || y < 0 || x >= buf.w || y >= buf.h) return;
  const i = y * buf.w + x, under = buf.px[i];
  const [r, g, b] = unpack(c);
  if (!under) { buf.px[i] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; return; }
  const [ur, ug, ub, ua] = unpack(under);
  if (ua < 255) { if (ua < a) buf.px[i] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; return; }
  const t = a / 255;
  buf.px[i] = ((255 << 24) | (Math.round(ub + (b - ub) * t) << 16) | (Math.round(ug + (g - ug) * t) << 8) | Math.round(ur + (r - ur) * t)) >>> 0;
}

export function frameCount(hero: HeroDef, anim: AnimName): number {
  return heroAnims(hero.style)[anim].length;
}

export function clearSpriteCache() { cache.clear(); }

// ── bosses ──

export function bossFrame(boss: BossDef, anim: BossAnim, index: number): Frame {
  const list = BOSS_ANIMS[anim];
  const i = ((index % list.length) + list.length) % list.length;
  const key = `boss:${boss.id}:${anim}:${i}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = list[i];
  let buf = new PixelBuffer(BOSS_FRAME.w, BOSS_FRAME.h);
  boss.paint(buf, BOSS_FRAME.anchor, p);
  buf.outline(OUTLINE);
  buf.glow(0.5 + Math.min(1, p.glow) * 0.5);
  if (p.fall) buf = buf.rotated(p.fall, BOSS_FRAME.anchor);
  const frame = { buf, anchor: BOSS_FRAME.anchor };
  cache.set(key, frame);
  return frame;
}
