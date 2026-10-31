/**
 * Sprite frames: every (character, animation, frame) is rasterised ONCE into a PixelBuffer and cached. The scene
 * only blits cached frames, so drawing a fight costs a few image copies per frame.
 *
 * Swappable art: a PNG sprite sheet listed in /sprites/manifest.json replaces the hand-coded sprite of the same id
 * (see ./sheets.ts and docs/pixel-sprites.md). This module is the procedural source.
 */
import { PixelBuffer, type Pt } from "./buffer";
import { BOSS_ANIMS, BOSS_FRAME, type BossAnim, type BossDef } from "./bosses";
import { hex } from "./color";
import { heroAnims, type AnimName, type HeroDef } from "./heroes";
import { drawHumanoid } from "./rig";

export interface Frame {
  buf: PixelBuffer;
  /** The ground point under the figure, in frame pixels. */
  anchor: Pt;
}

export const HERO_FRAME = { w: 176, h: 124, anchor: [100, 118] as Pt };
const OUTLINE = hex("#0b0a12");

const cache = new Map<string, Frame>();

/** Two looks of one hero (gear tints) are different frames: the key carries the look's signature colours. */
export const lookKey = (hero: HeroDef) => `${hero.id}:${hero.look.weaponGlow?.ramp[2] ?? ""}:${hero.look.top.ramp[2]}`;

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
  if (pose.fall) buf = buf.rotated(pose.fall, HERO_FRAME.anchor);
  const frame = { buf, anchor: HERO_FRAME.anchor };
  cache.set(key, frame);
  return frame;
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
  if (p.fall) buf = buf.rotated(p.fall, BOSS_FRAME.anchor);
  const frame = { buf, anchor: BOSS_FRAME.anchor };
  cache.set(key, frame);
  return frame;
}
