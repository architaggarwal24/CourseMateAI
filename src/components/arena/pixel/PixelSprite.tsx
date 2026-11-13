"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotionConfig } from "motion/react";
import type { PixelBuffer } from "@/lib/pixel/buffer";
import { toCanvas } from "@/lib/pixel/canvas";
import { BOSS_FIDGETS, BOSS_FPS, bossAnimFrames, bossById, type BossAnim } from "@/lib/pixel/bosses";
import { ANIM_FPS, ANIM_LOOP, FIDGETS, heroAnims, type AnimName, type HeroDef } from "@/lib/pixel/heroes";
import { PET_FPS, PET_FRAME, PET_FRAMES, PET_OFFSET, petById, petFrame } from "@/lib/pixel/pets";
import { bossFrame, heroFrame, HERO_FRAME } from "@/lib/pixel/sprites";
import { solve } from "@/lib/pixel/rig";
import { nextFrameAt, tick } from "@/lib/pixel/ticker";

/** Frames come from the sprite cache and never change, so their tight boxes are measured once each. */
const boundsCache = new WeakMap<PixelBuffer, [number, number, number, number]>();
function boundsOf(buf: PixelBuffer): [number, number, number, number] {
  let b = boundsCache.get(buf);
  if (!b) { b = buf.bounds(); boundsCache.set(buf, b); }
  return b;
}

/** Calls back with whether the element is on screen (scrolled into view, not display:none); always on without IntersectionObserver. */
function watchVisible(el: Element, on: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === "undefined") { on(true); return () => {}; }
  const io = new IntersectionObserver((entries) => on(entries[entries.length - 1].isIntersecting), { rootMargin: "64px" });
  io.observe(el);
  return () => io.disconnect();
}

/** One animated thing on the canvas: frames by index, at an offset in the hero frame's coordinates. */
interface Layer { at: (i: number) => PixelBuffer; count: number; fps: number; loop: boolean; dx: number; dy: number }

/**
 * One animated pixel sprite on a transparent canvas: a champion (optionally with its pet idling beside it), a
 * creature, or a pet on its own. Drawn at native resolution and scaled by CSS with nearest-neighbour, so it stays
 * crisp at any size. Under reduced motion (OS or the app's setting) it shows one still frame.
 *
 * Accessibility: give `label` for a sprite that means something on its own (role="img"); without it the canvas
 * is decorative (aria-hidden) and the words around it must carry the information.
 *
 * `fidget` (Stage 7): left idle, the sprite plays one of its idle fidgets now and then (a champion's style has three,
 * a creature two), never the same twice in a row; its frame is sized for all of them so nothing jumps.
 */
/** How long an idle sprite waits before a fidget (ms, a random wait in the range). */
export const SPRITE_FIDGET_WAIT: [number, number] = [4500, 9000];
export default function PixelSprite({ hero, boss, pet, petStage = "young", anim = "idle", flip = false, className, label, crop = true, portrait = false, still = false, fidget = false }: {
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
  /** Stage 7: idle fidgets now and then. */
  fidget?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = !!useReducedMotionConfig() || still;
  const petId = pet && petById(pet) ? pet : null;
  // Stage 7: the fidget playing now (it takes the place of the idle until it ends)
  const fidgets = !fidget || reduced || anim !== "idle" || portrait ? null : hero ? FIDGETS : boss ? BOSS_FIDGETS : null;
  const [playing, setPlaying] = useState<string | null>(null);
  const lastFidget = useRef<string | null>(null);
  useEffect(() => {
    if (!fidgets) { setPlaying(null); return; }
    if (playing) {
      const frames = hero ? heroAnims(hero.style)[playing as AnimName].length : bossAnimFrames(bossById(boss!).id, playing as BossAnim).length;
      const fps = hero ? ANIM_FPS[playing as AnimName] : BOSS_FPS[playing as BossAnim];
      const t = setTimeout(() => setPlaying(null), Math.ceil((frames / fps) * 1000) + 60);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      const pick = fidgets.filter((f) => f !== lastFidget.current);
      const next = pick[Math.floor(Math.random() * pick.length)];
      lastFidget.current = next;
      setPlaying(next);
    }, SPRITE_FIDGET_WAIT[0] + Math.random() * (SPRITE_FIDGET_WAIT[1] - SPRITE_FIDGET_WAIT[0]));
    return () => clearTimeout(t);
  }, [playing, fidgets?.join(","), hero?.style, boss]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (playing ?? anim) as AnimName | BossAnim;
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.("2d");
    if (!canvas || !ctx) return;                       // no canvas support (tests, very old browsers): nothing drawn

    const layers: Layer[] = [];
    // a sprite that fidgets is sized for its idle and every fidget (measured, never drawn)
    const measure: Layer[] = [];
    if (hero) {
      const a = shown as AnimName;
      if (fidgets) for (const f of ["idle", ...FIDGETS] as AnimName[]) measure.push({ at: (i) => heroFrame(hero, f, i).buf, count: heroAnims(hero.style)[f].length, fps: 1, loop: false, dx: 0, dy: 0 });
      layers.push({ at: (i) => heroFrame(hero, a, i).buf, count: still ? 1 : heroAnims(hero.style)[a].length, fps: ANIM_FPS[a], loop: ANIM_LOOP[a], dx: 0, dy: 0 });
    } else if (boss) {
      const a = shown as BossAnim, def = bossById(boss);
      if (fidgets) for (const f of ["idle", ...BOSS_FIDGETS] as BossAnim[]) measure.push({ at: (i) => bossFrame(def, f, i).buf, count: bossAnimFrames(def.id, f).length, fps: 1, loop: false, dx: 0, dy: 0 });
      layers.push({ at: (i) => bossFrame(def, a, i).buf, count: bossAnimFrames(def.id, a).length, fps: BOSS_FPS[a], loop: a === "idle", dx: 0, dy: 0 });
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
      for (const l of [...layers, ...measure]) for (let i = 0; i < l.count; i++) {
        const [x, y, w, h] = boundsOf(l.at(i));
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
        const [x, y, w, h] = boundsOf(main.at(0));
        const side = Math.round(Math.min(w, h) * 0.6);
        box = [Math.round(x + w - side), y, side, side];
      }
    }
    canvas.width = box[2]; canvas.height = box[3];

    // drawn on the shared sprite clock (lib/pixel/ticker): only when a frame changes, only while on screen
    let last = "";
    const start = performance.now();
    const indexOf = (l: Layer, t: number) => {
      const raw = Math.floor(((t - start) / 1000) * l.fps);
      return reduced ? 0 : l.loop ? raw % l.count : Math.min(l.count - 1, raw);
    };
    const draw = (t: number) => {
      const idx = layers.map((l) => indexOf(l, t));
      const key = idx.join(",");
      if (key === last) return;
      last = key;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (flip) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      layers.forEach((l, n) => ctx.drawImage(toCanvas(l.at(idx[n])), l.dx - box[0], l.dy - box[1]));
      ctx.restore();
    };
    const due = (t: number) => {
      let next: number | null = null;
      for (const l of layers) {
        const at = nextFrameAt(start, l.fps, t, l.count, l.loop);
        if (at !== null && (next === null || at < next)) next = at;
      }
      return next;
    };
    draw(start);
    if (reduced) return;
    let stop: (() => void) | null = null;
    const pause = () => { stop?.(); stop = null; };
    const resume = () => {
      if (stop || document.visibilityState === "hidden") return;
      const now = performance.now();
      draw(now);
      const first = due(now);
      if (first !== null) stop = tick(first, (t) => { draw(t); return due(t); });
    };
    const unwatch = watchVisible(canvas, (visible) => (visible ? resume() : pause()));
    const onVisibility = () => (document.visibilityState === "hidden" ? pause() : resume());
    document.addEventListener("visibilitychange", onVisibility);
    return () => { pause(); unwatch(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [hero, boss, petId, petStage, shown, flip, reduced, crop, portrait, !!fidgets]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <canvas
      ref={ref}
      className={`pixel-canvas ${className ?? ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-playing={!reduced}
      data-fidget={playing ?? undefined}
    />
  );
}
