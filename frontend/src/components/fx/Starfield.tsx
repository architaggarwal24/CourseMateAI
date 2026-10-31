"use client";

import { useEffect, useRef } from "react";
import { reducedMotion } from "./motion";

interface Star { x: number; y: number; z: number; r: number; tw: number; hue: 0 | 1 | 2 }

/**
 * The Play backdrop: a canvas of twinkling stars in three depth layers that drift slowly and lean away from the
 * pointer (parallax). Colours come from the theme (--color-text, --color-accent-text, --color-highlight-text).
 * Stops drawing when the tab is hidden; draws one still frame under reduced motion. Decorative only.
 */
export default function Starfield({ density = 0.00012, className = "fx-stars" }: { density?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const css = getComputedStyle(canvas);
    const colors = [css.getPropertyValue("--color-text"), css.getPropertyValue("--color-accent-text"), css.getPropertyValue("--color-highlight-text")]
      .map((c) => c.trim() || "white");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, stars: Star[] = [], frame = 0, last = performance.now();
    let mx = 0, my = 0, tx = 0, ty = 0;

    const seed = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(40, Math.min(420, Math.round(w * h * density)));
      stars = Array.from({ length: n }, () => {
        const z = Math.random();
        return { x: Math.random() * w, y: Math.random() * h, z, r: 0.4 + z * 1.3, tw: Math.random() * Math.PI * 2,
          hue: (Math.random() < 0.8 ? 0 : Math.random() < 0.6 ? 1 : 2) as 0 | 1 | 2 };
      });
    };

    const draw = (t: number, dt: number) => {
      ctx.clearRect(0, 0, w, h);
      tx += (mx - tx) * 0.04; ty += (my - ty) * 0.04;
      for (const s of stars) {
        s.y -= dt * 0.004 * (0.2 + s.z);                       // a slow upward drift, faster when nearer
        if (s.y < -4) { s.y = h + 4; s.x = Math.random() * w; }
        const px = s.x - tx * (6 + s.z * 18);
        const py = s.y - ty * (6 + s.z * 18);
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.0015 * (0.6 + s.z) + s.tw));
        ctx.globalAlpha = a * (0.35 + s.z * 0.65);
        ctx.fillStyle = colors[s.hue];
        ctx.beginPath();
        ctx.arc(px, py, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.z > 0.92) {                                         // the nearest few get a soft halo
          ctx.globalAlpha = a * 0.15;
          ctx.beginPath(); ctx.arc(px, py, s.r * 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (t: number) => {
      const dt = Math.min(64, t - last); last = t;
      draw(t, dt);
      frame = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; };
    const onVis = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden && !reducedMotion()) { last = performance.now(); frame = requestAnimationFrame(loop); }
    };

    seed();
    const ro = new ResizeObserver(() => { seed(); if (reducedMotion()) draw(0, 0); });
    ro.observe(canvas);
    if (reducedMotion()) draw(0, 0);
    else { frame = requestAnimationFrame(loop); window.addEventListener("pointermove", onMove, { passive: true }); }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [density]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
