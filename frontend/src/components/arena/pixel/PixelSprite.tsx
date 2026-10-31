"use client";

import { useEffect, useRef } from "react";
import { useReducedMotionConfig } from "motion/react";
import { toCanvas } from "@/lib/pixel/canvas";
import { BOSS_ANIMS, BOSS_FPS, bossById, type BossAnim } from "@/lib/pixel/bosses";
import { ANIM_FPS, ANIM_LOOP, heroAnims, type AnimName, type HeroDef } from "@/lib/pixel/heroes";
import { bossFrame, heroFrame, HERO_FRAME } from "@/lib/pixel/sprites";
import { solve } from "@/lib/pixel/rig";

/**
 * One animated pixel sprite on a transparent canvas (roster cards, the bestiary, the summon screen). Drawn at its
 * native resolution and scaled by CSS with nearest-neighbour, so it stays crisp at any size.
 */
export default function PixelSprite({ hero, boss, anim = "idle", flip = false, className, label, crop = true, portrait = false }: {
  hero?: HeroDef; boss?: string; anim?: AnimName | BossAnim; flip?: boolean; className?: string;
  /** Accessible name; omit for a decorative sprite. */
  label?: string;
  /** Trim the frame to the sprite's own bounds (a card shows the figure, not empty frame). */
  crop?: boolean;
  /** Just the head and shoulders (HUD portraits). */
  portrait?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotionConfig();
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.("2d");
    if (!canvas || !ctx) return;                       // no canvas support (tests, very old browsers): nothing drawn
    const frameAt = (i: number) => (hero ? heroFrame(hero, anim as AnimName, i) : bossFrame(bossById(boss), anim as BossAnim, i));
    const count = hero ? heroAnims(hero.style)[anim as AnimName].length : BOSS_ANIMS[anim as BossAnim].length;
    const fps = hero ? ANIM_FPS[anim as AnimName] : BOSS_FPS[anim as BossAnim];
    const loop = hero ? ANIM_LOOP[anim as AnimName] : anim === "idle";
    // one box that fits every frame, so the figure doesn't jump around
    let box: [number, number, number, number] = [0, 0, 0, 0];
    const first = frameAt(0).buf;
    if (crop) {
      let x0 = first.w, y0 = first.h, x1 = 0, y1 = 0;
      for (let i = 0; i < count; i++) {
        const [x, y, w, h] = frameAt(i).buf.bounds();
        if (!w) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
      }
      box = x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, first.w, first.h];
    } else box = [0, 0, first.w, first.h];
    if (portrait) {
      // the top of the idle frame, a square around the head (heroes) / the front half (creatures face right)
      if (hero) {
        const k = solve(hero.look.build, heroAnims(hero.style).idle[0], HERO_FRAME.anchor, hero.look.scale);
        box = [Math.round(k.headC[0] - 15), Math.round(k.headC[1] - 15), 30, 30];
      } else {
        const [x, y, w, h] = frameAt(0).buf.bounds();
        const side = Math.round(Math.min(w, h) * 0.6);
        box = [Math.round(x + w - side), y, side, side];
      }
    }
    canvas.width = box[2]; canvas.height = box[3];
    let raf = 0, start = performance.now(), lastI = -1;
    const draw = (t: number) => {
      const raw = Math.floor(((t - start) / 1000) * fps);
      const i = reduced ? 0 : loop ? raw % count : Math.min(count - 1, raw);
      if (i !== lastI) {
        lastI = i;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        if (flip) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
        ctx.drawImage(toCanvas(frameAt(i).buf), -box[0], -box[1]);
        ctx.restore();
      }
      if (!reduced && (loop || raw < count)) raf = requestAnimationFrame(draw);
    };
    start = performance.now();
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [hero, boss, anim, flip, reduced, crop, portrait]);
  return <canvas ref={ref} className={`pixel-canvas ${className ?? ""}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
