"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotionConfig } from "motion/react";
import { useCelebrate } from "@/lib/fx/celebrate";

/** A 9x9 pixel coin (two frames: face and edge, so it spins as it falls). */
function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, edge: boolean) {
  const px = (cx: number, cy: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x + cx * s), Math.round(y + cy * s), Math.ceil(w * s), Math.ceil(h * s)); };
  if (edge) { px(3, 0, 3, 9, "#7a5308"); px(4, 1, 1, 7, "#f5b942"); return; }
  px(2, 0, 5, 9, "#7a5308"); px(0, 2, 9, 5, "#7a5308"); px(1, 1, 7, 7, "#7a5308");
  px(2, 1, 5, 7, "#f5b942"); px(1, 2, 7, 5, "#f5b942");
  px(3, 2, 1, 5, "#fff2c2"); px(5, 3, 1, 3, "#c98a12");
}

/**
 * A shower of pixel coins over the whole screen when something pays out (a quest claimed, a chest opened). Mounted
 * once in the app shell; decorative; nothing under reduced motion. The full-screen canvas exists only while coins
 * fall: left in the page it was one more screen-sized layer for the browser to composite on every frame.
 */
export default function CoinRain() {
  const rain = useCelebrate((s) => s.rain);
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = !!useReducedMotionConfig();
  const [falling, setFalling] = useState<number | null>(null);
  useEffect(() => { if (rain && !reduced) setFalling(rain.id); }, [rain, reduced]);
  useEffect(() => {
    const c = ref.current, ctx = c?.getContext?.("2d");
    if (!rain || falling !== rain.id || !c || !ctx || reduced) return;
    const W = (c.width = window.innerWidth), H = (c.height = window.innerHeight);
    const coins = Array.from({ length: rain.coins }, (_, i) => ({
      x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vy: 3 + Math.random() * 4, vx: (Math.random() - 0.5) * 1.2,
      s: 2 + Math.floor(Math.random() * 2), spin: Math.random() * 10, i,
    }));
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const k of coins) {
        k.vy += 0.15; k.y += k.vy; k.x += k.vx; k.spin += 0.25;
        if (k.y < H + 30) { alive++; drawCoin(ctx, k.x, k.y, k.s, Math.floor(k.spin) % 4 === 2); }
      }
      if (alive && t - start < 4000) raf = requestAnimationFrame(tick); else { ctx.clearRect(0, 0, W, H); setFalling(null); }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); };
  }, [rain, falling, reduced]);
  return falling !== null ? <canvas ref={ref} className="fx-coin-rain" aria-hidden="true" /> : null;
}
