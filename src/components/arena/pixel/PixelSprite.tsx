"use client";

import { useEffect, useRef } from "react";
import { useReducedMotionConfig } from "motion/react";
import type { PixelBuffer } from "@/lib/pixel/buffer";
import { toCanvas } from "@/lib/pixel/canvas";
import { BOSS_ANIMS, BOSS_FPS, bossById, type BossAnim } from "@/lib/pixel/bosses";
import { ANIM_FPS, ANIM_LOOP, heroAnims, type AnimName, type HeroDef } from "@/lib/pixel/heroes";
import { PET_FPS, PET_FRAME, PET_FRAMES, PET_OFFSET, petById, petFrame } from "@/lib/pixel/pets";
import { bossFrame, heroFrame, HERO_FRAME } from "@/lib/pixel/sprites";
import { solve } from "@/lib/pixel/rig";

/** One animated thing on the canvas: frames by index, at an offset in the hero frame's coordinates. */
interface Layer { at: (i: number) => PixelBuffer; count: number; fps: number; loop: boolean; dx: number; dy: number }

/**
 * One animated pixel sprite on a transparent canvas: a champion (optionally with its pet idling beside it), a
 * creature, or a pet on its own. Drawn at native resolution and scaled by CSS with nearest-neighbour, so it stays
 * crisp at any size. Under reduced motion (OS or the app's setting) it shows one still frame.
 *
 * Accessibility: give `label` for a sprite that means something on its own (role="img"); without it the canvas
 * is decorative (aria-hidden) and the words around it must carry the information.
 */
export default function PixelSprite({ hero, boss, pet, petStage = "young", anim = "idle", flip = false, className, label, crop = true, portrait = false, still = false }: {
  hero?: HeroDef; boss?: string;
  /** A pet id: beside the champion (full body), or alone when no hero / boss is given. */
  pet?: string | null;
  /** How grown the pet is (forge tiers). */
  petStage?: "baby" | "young" | "adult";
  anim?: AnimName | BossAnim; flip?: boolean; className?: string;
  /** Accessible name; omit for a decorative sprite. */
  label?: string;
  /** Trim the frame to the sprite's own bounds (a card shows the figure, not empty frame). */
  crop?: boolean;
  /** Just the head and shoulders (HUD portraits, avatars). Never shows the pet. */
  portrait?: boolean;
  /** One still frame, whatever the motion setting (rows of small previews: cheap to redraw). */
  still?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = !!useReducedMotionConfig() || still;
  const petId = pet && petById(pet) ? pet : null;
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.("2d");
    if (!canvas || !ctx) return;                       // no canvas support (tests, very old browsers): nothing drawn

    const layers: Layer[] = [];
    if (hero) {
      const a = anim as AnimName;
      layers.push({ at: (i) => heroFrame(hero, a, i).buf, count: still ? 1 : heroAnims(hero.style)[a].length, fps: ANIM_FPS[a], loop: ANIM_LOOP[a], dx: 0, dy: 0 });
    } else if (boss) {
      const a = anim as BossAnim, def = bossById(boss);
      layers.push({ at: (i) => bossFrame(def, a, i).buf, count: BOSS_ANIMS[a].length, fps: BOSS_FPS[a], loop: a === "idle", dx: 0, dy: 0 });
    }
    if (petId && !portrait && !boss) {
      const [dx, dy] = hero ? [HERO_FRAME.anchor[0] + PET_OFFSET[0] - PET_FRAME.anchor[0], HERO_FRAME.anchor[1] + PET_OFFSET[1] - PET_FRAME.anchor[1]] : [0, 0];
      // behind the champion: drawn first
      layers.unshift({ at: (i) => petFrame(petId, i, petStage)!, count: PET_FRAMES, fps: PET_FPS, loop: true, dx, dy });
    }
    if (!layers.length) return;

    // one box that fits every frame of every layer, so nothing jumps around
    let box: [number, number, number, number];
    const main = layers[layers.length - 1];
    if (crop) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const l of layers) for (let i = 0; i < l.count; i++) {
        const [x, y, w, h] = l.at(i).bounds();
        if (!w) continue;
        x0 = Math.min(x0, x + l.dx); y0 = Math.min(y0, y + l.dy); x1 = Math.max(x1, x + l.dx + w); y1 = Math.max(y1, y + l.dy + h);
      }
      const first = main.at(0);
      box = x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : [0, 0, first.w, first.h];
    } else {
      const first = main.at(0);
      box = [0, 0, first.w, first.h];
    }
    if (portrait) {
      // the top of the idle frame, a square around the head (heroes) / the front half (creatures face right)
      if (hero) {
        const k = solve(hero.look.build, heroAnims(hero.style).idle[0], HERO_FRAME.anchor, hero.look.scale);
        box = [Math.round(k.headC[0] - 15), Math.round(k.headC[1] - 15), 30, 30];
      } else {
        const [x, y, w, h] = main.at(0).bounds();
        const side = Math.round(Math.min(w, h) * 0.6);
        box = [Math.round(x + w - side), y, side, side];
      }
    }
    canvas.width = box[2]; canvas.height = box[3];

    let raf = 0, last = "";
    const start = performance.now();
    const indexOf = (l: Layer, t: number) => {
      const raw = Math.floor(((t - start) / 1000) * l.fps);
      return reduced ? 0 : l.loop ? raw % l.count : Math.min(l.count - 1, raw);
    };
    const draw = (t: number) => {
      const idx = layers.map((l) => indexOf(l, t));
      const key = idx.join(",");
      if (key !== last) {
        last = key;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        if (flip) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
        layers.forEach((l, n) => ctx.drawImage(toCanvas(l.at(idx[n])), l.dx - box[0], l.dy - box[1]));
        ctx.restore();
      }
      const more = layers.some((l) => l.loop || Math.floor(((t - start) / 1000) * l.fps) < l.count);
      if (!reduced && more) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [hero, boss, petId, petStage, anim, flip, reduced, crop, portrait]);
  return (
    <canvas
      ref={ref}
      className={`pixel-canvas ${className ?? ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-playing={!reduced}
    />
  );
}
