"use client";

import { useEffect, useRef } from "react";
import { useReducedMotionConfig } from "motion/react";

export type Burst = "common" | "rare" | "epic" | "legendary";
/** How much confetti each rarity throws, and in which colours (the last ones are coins). */
export const BURSTS: Record<Burst, { pieces: number; colors: string[] }> = {
  common: { pieces: 70, colors: ["#b0b0b0", "#ffffff", "#f5b942", "#8a9df2"] },
  rare: { pieces: 110, colors: ["#6db3ff", "#ffffff", "#f5b942", "#3550c8"] },
  epic: { pieces: 160, colors: ["#c79bff", "#ffffff", "#f5b942", "#7c3aed", "#6db3ff"] },
  legendary: { pieces: 230, colors: ["#ffb84d", "#fff2c2", "#f5b942", "#ff6b6b", "#c79bff", "#ffffff"] },
};

interface Piece { x: number; y: number; vx: number; vy: number; size: number; color: string; spin: number; life: number }

/**
 * A burst of square pixel confetti over its parent (a canvas, drawn with nearest-neighbour squares), fired once when
 * it mounts or when `fire` changes. Decorative (aria-hidden); nothing at all under reduced motion.
 */
export default function PixelConfetti({ burst = "common", fire = 0, className }: { burst?: Burst; fire?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = !!useReducedMotionConfig();
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext?.("2d");
    if (!c || !ctx || reduced) return;
    const W = (c.width = c.clientWidth || 400), H = (c.height = c.clientHeight || 400);
    const spec = BURSTS[burst];
    const pieces: Piece[] = Array.from({ length: spec.pieces }, (_, i) => {
      const fromLeft = i % 2 === 0;
      const angle = (fromLeft ? -60 : -120) + (Math.random() - 0.5) * 50;
      const speed = 7 + Math.random() * 7;
      return {
        x: fromLeft ? W * 0.15 : W * 0.85, y: H * 0.75,
        vx: Math.cos((angle * Math.PI) / 180) * speed, vy: Math.sin((angle * Math.PI) / 180) * speed,
        size: 3 + Math.floor(Math.random() * 3) * 2, color: spec.colors[i % spec.colors.length], spin: Math.random(), life: 1,
      };
    });
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of pieces) {
        if (p.life <= 0) continue;
        p.vy += 0.28; p.vx *= 0.985; p.vy *= 0.99;
        p.x += p.vx; p.y += p.vy; p.spin += 0.15;
        if (p.y > H * 0.6) p.life -= 0.012;
        if (p.y > H + 10) p.life = 0;
        if (p.life <= 0) continue;
        alive++;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
        ctx.fillStyle = p.color;
        // a square that flips as it falls: a full square, then a thin edge (pixel "spin")
        const w = Math.abs(Math.cos(p.spin)) > 0.4 ? p.size : 2;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), w, p.size);
      }
      ctx.globalAlpha = 1;
      if (alive) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [burst, fire, reduced]);
  return <canvas ref={ref} className={className ?? "px-confetti"} aria-hidden="true" />;
}
