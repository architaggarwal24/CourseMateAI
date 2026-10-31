"use client";
// The twelve hats, drawn over the hair. Coordinates are the hero's own (head centred on x = 100, top at y ~ 30).
import type { ReactNode } from "react";
import { CX } from "./body";
import { L, P, circ, ell, rr, tone } from "./primitives";

export interface HatArt {
  draw: () => ReactNode;
  /** the part of the hero worth showing in an icon: x, y, w, h */
  box: [number, number, number, number];
  /** drawn behind the head (neck guards, ear cups' band) */
  back?: () => ReactNode;
}

const headband = (color: string, knot = color): HatArt => ({
  box: [38, 36, 124, 62],
  draw: () => (
    <g>
      <P d="M 47 66 Q 100 48 153 66 L 153 80 Q 100 62 47 80 Z" fill={color} />
      <P d="M 148 70 L 176 58 L 170 74 L 184 84 L 160 86 Z" fill={knot} sw={2.8} />
      <circle cx={100} cy={64} r={0} />
    </g>
  ),
});

const star = (x: number, y: number, r: number, fill: string) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? r * 0.45 : r;
    return `${(x + rad * Math.cos(a)).toFixed(1)} ${(y + rad * Math.sin(a)).toFixed(1)}`;
  });
  return <path d={`M ${pts.join(" L ")} Z`} fill={fill} stroke="#1c1530" strokeWidth={1.8} strokeLinejoin="round" />;
};

const crown = (metal: string, gem: string, tall: number, points: number): HatArt => ({
  box: [48, 4, 104, 80],
  draw: () => {
    const w = 84, x0 = CX - w / 2, base = 62, top = base - tall;
    const step = w / (points - 1);
    let d = `M ${x0} ${base}`;
    for (let i = 0; i < points; i++) {
      const x = x0 + i * step;
      d += ` L ${x} ${top + (i % 2 ? 12 : 0)}`;
      if (i < points - 1) d += ` L ${x + step / 2} ${base - tall * 0.38}`;
    }
    d += ` L ${x0 + w} ${base} Z`;
    return (
      <g>
        <P d={d} fill={metal} />
        <P d={rr(x0 - 2, base - 4, w + 4, 14, 4)} fill={tone(metal, -0.12)} sw={3} />
        {Array.from({ length: points }, (_, i) => <circle key={i} cx={x0 + i * step} cy={top + (i % 2 ? 12 : 0) - 3} r={3.6} fill={gem} stroke="#1c1530" strokeWidth={1.8} />)}
        <circle cx={CX} cy={base + 3} r={4.4} fill={gem} stroke="#1c1530" strokeWidth={2} />
      </g>
    );
  },
});

export const HATS: Record<string, HatArt> = {
  hat_headband_red: headband("#d6313c"),
  hat_headband_blue: headband("#2f5fd6"),
  hat_headband_white: headband("#f4f1fb"),
  hat_baseball_red: {
    box: [40, 18, 120, 66],
    draw: () => (
      <g>
        <P d="M 50 70 C 50 34 76 22 100 22 C 124 22 150 34 150 70 Q 100 60 50 70 Z" fill="#d6313c" />
        <P d="M 54 72 Q 100 56 146 72 Q 168 78 170 86 Q 100 70 40 88 Q 40 78 54 72 Z" fill="#a81f2b" />
        <L d="M 100 24 V 60" color="#a81f2b" w={2.5} opacity={0.6} />
        <circle cx={100} cy={26} r={3.4} fill="#a81f2b" stroke="#1c1530" strokeWidth={2} />
        <P d="M 84 44 q 8 -6 16 0 q 8 -6 16 0 l -4 10 q -4 -3 -12 0 q -8 -3 -12 0 Z" fill="#fff" sw={2} shade={false} />
      </g>
    ),
  },
  hat_beanie_blue: {
    box: [40, 6, 120, 80],
    draw: () => (
      <g>
        <P d="M 50 66 C 46 30 72 16 100 16 C 128 16 154 30 150 66 Z" fill="#3a7bd5" />
        <P d={rr(46, 58, 108, 22, 9)} fill="#ecf3ff" />
        {[62, 78, 94, 110, 126, 142].map((x) => <L key={x} d={`M ${x} 60 V 78`} color="#a9bddb" w={2.4} />)}
        {[66, 90, 114, 134].map((x) => <L key={x} d={`M ${x} 26 Q ${x + 2} 42 ${x} 56`} color="#2a62ad" w={2.4} />)}
        <P d={circ(100, 12, 11)} fill="#ecf3ff" />
      </g>
    ),
  },
  hat_headphones: {
    box: [30, 14, 140, 100],
    back: () => null,
    draw: () => (
      <g>
        <L d="M 48 90 C 40 30 160 30 152 90" color="#1c1530" w={13} />
        <L d="M 48 90 C 40 30 160 30 152 90" color="#515a78" w={7} />
        {[46, 154].map((x) => (
          <g key={x}>
            <P d={rr(x - 14, 72, 28, 44, 12)} fill="#2e3550" />
            <P d={rr(x - 8, 80, 16, 28, 8)} fill="#14172a" sw={2} shade={false} />
            <L d={`M ${x - 4} 88 V 100`} color="#46e3ff" w={3.4} />
          </g>
        ))}
      </g>
    ),
  },
  hat_wizard: {
    box: [30, -14, 140, 110],
    draw: () => (
      <g>
        <P d="M 22 70 Q 100 52 178 70 Q 100 90 22 70 Z" fill="#3a2c82" />
        <P d="M 54 66 Q 62 30 84 4 Q 112 -22 122 -34 Q 126 -4 142 30 Q 148 50 148 66 Q 100 78 54 66 Z" fill="#4b3aa8" />
        <P d="M 54 62 Q 100 76 148 62 L 148 52 Q 100 66 54 52 Z" fill="#f2c14e" sw={2.8} />
        {star(96, 24, 8, "#ffe08a")}{star(116, 40, 5, "#ffe08a")}
      </g>
    ),
  },
  hat_crown_bronze: crown("#cf9650", "#39d98a", 24, 5),
  hat_crown_silver: crown("#d7deef", "#7be3ff", 28, 5),
  hat_crown_gold: crown("#ffd24a", "#ff4d6d", 34, 7),
  hat_ninja: {
    box: [34, 36, 140, 70],
    draw: () => (
      <g>
        <P d="M 47 62 Q 100 44 153 62 L 153 82 Q 100 64 47 82 Z" fill="#26203a" />
        <P d={rr(76, 54, 48, 22, 5)} fill="#c5cde0" sw={3} />
        <L d="M 84 65 H 116 M 88 60 V 70 M 112 60 V 70" color="#26203a" w={2.4} />
        <P d="M 150 68 L 182 70 L 172 80 L 186 96 L 158 86 Z" fill="#26203a" sw={2.8} />
      </g>
    ),
  },
  hat_samurai: {
    box: [24, -6, 152, 100],
    draw: () => (
      <g>
        <P d="M 40 100 Q 34 70 50 58 L 72 70 L 70 104 Z" fill="#2c3a6b" />
        <P d="M 160 100 Q 166 70 150 58 L 128 70 L 130 104 Z" fill="#2c3a6b" />
        <P d="M 48 66 C 48 28 74 16 100 16 C 126 16 152 28 152 66 Q 100 56 48 66 Z" fill="#c2253d" />
        <P d="M 44 66 Q 100 52 156 66 L 156 76 Q 100 62 44 76 Z" fill="#2a2440" />
        <P d="M 84 20 Q 78 -10 60 -22 Q 90 -12 100 12 Q 110 -12 140 -22 Q 122 -10 116 20 Z" fill="#ffd24a" sw={3} />
        <P d="M 92 36 L 100 28 L 108 36 L 100 56 Z" fill="#ffd24a" sw={2.6} />
      </g>
    ),
  },
};

export const hatOf = (id: string): HatArt | undefined => HATS[id];
export { ell };
