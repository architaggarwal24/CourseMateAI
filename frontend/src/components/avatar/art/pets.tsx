"use client";
// The ten companions. Each is drawn on its own ground line: (0, 0) is where its feet meet the floor, facing right
// (toward the hero), about 60 units tall. The hero scene places them to the hero's left.
import type { ReactNode } from "react";
import { L, P, circ, ell, rr } from "./primitives";

export interface PetArt {
  draw: () => ReactNode;
  /** how big it stands next to the hero (1 = a house pet) */
  scale: number;
  /** floats above the ground by this much */
  lift?: number;
}

const eye = (x: number, y: number, r = 2.6) => <g><circle cx={x} cy={y} r={r} fill="#1c1530" /><circle cx={x - r * 0.35} cy={y - r * 0.4} r={r * 0.38} fill="#fff" /></g>;
const legs = (c: string, xs: number[], h = 10) => <>{xs.map((x) => <P key={x} d={rr(x - 4, -h, 8, h, 3.5)} fill={c} sw={3} />)}</>;
const tri = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => `M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3} Z`;

export const PETS: Record<string, PetArt> = {
  pet_cat_orange: {
    scale: 1,
    draw: () => (
      <g>
        <P d="M -18 -18 C -40 -22 -40 -52 -26 -50 C -30 -40 -24 -30 -14 -28 Z" fill="#ff9a3d" />
        {legs("#ff9a3d", [-12, 12])}
        <P d={ell(0, -20, 21, 15)} fill="#ff9a3d" />
        <L d="M -8 -32 v 8 M 0 -34 v 9 M 8 -32 v 8" color="#c4601a" w={2.6} />
        <P d={tri(6, -48, 10, -62, 18, -50)} fill="#ff9a3d" sw={3} />
        <P d={tri(18, -50, 26, -62, 28, -46)} fill="#ff9a3d" sw={3} />
        <P d={circ(17, -40, 13)} fill="#ff9a3d" />
        <P d={ell(20, -34, 6, 4.4)} fill="#ffe7c9" sw={2} shade={false} />
        {eye(13, -42)}{eye(23, -42)}
        <path d="M 17 -37 l 2.6 0 l -1.3 2 Z" fill="#ff7f9a" />
      </g>
    ),
  },
  pet_dog_brown: {
    scale: 1,
    draw: () => (
      <g>
        <P d="M -20 -26 Q -34 -42 -30 -52 Q -22 -44 -14 -30 Z" fill="#9a6a3a" />
        {legs("#9a6a3a", [-13, 13], 12)}
        <P d={ell(0, -22, 23, 15)} fill="#9a6a3a" />
        <P d={ell(0, -16, 15, 8)} fill="#e3c39a" sw={0} shade={false} />
        <P d={circ(18, -42, 13)} fill="#9a6a3a" />
        <P d={ell(24, -36, 9, 6.5)} fill="#e3c39a" sw={2.6} />
        <path d="M 22 -39 h 6 l -3 4 Z" fill="#1c1530" />
        <P d="M 6 -52 Q -2 -44 6 -30 Q 12 -36 12 -46 Z" fill="#6e4421" sw={3} />
        {eye(16, -45)}{eye(26, -45)}
        <P d="M 25 -31 q 1 8 5 7 q 2 -4 0 -7 Z" fill="#ff7f9a" sw={2} shade={false} />
      </g>
    ),
  },
  pet_owl: {
    scale: 1,
    draw: () => (
      <g>
        {legs("#ffb347", [-6, 6], 8)}
        <P d={ell(0, -28, 19, 26)} fill="#8c6a4a" />
        <P d={ell(0, -22, 12, 16)} fill="#e9d3b2" sw={0} shade={false} />
        <P d={tri(-18, -42, -16, -62, -6, -50)} fill="#8c6a4a" sw={3} />
        <P d={tri(18, -42, 16, -62, 6, -50)} fill="#8c6a4a" sw={3} />
        <P d={circ(-8, -40, 9)} fill="#fff7e0" sw={3} shade={false} />
        <P d={circ(8, -40, 9)} fill="#fff7e0" sw={3} shade={false} />
        <circle cx={-8} cy={-40} r={4.6} fill="#ffb347" /><circle cx={8} cy={-40} r={4.6} fill="#ffb347" />
        {eye(-8, -40, 2.6)}{eye(8, -40, 2.6)}
        <path d="M -3 -34 L 3 -34 L 0 -27 Z" fill="#ffb347" stroke="#1c1530" strokeWidth={2} strokeLinejoin="round" />
        <P d="M -19 -32 Q -30 -20 -14 -8 Z" fill="#6d4f35" sw={3} />
        <P d="M 19 -32 Q 30 -20 14 -8 Z" fill="#6d4f35" sw={3} />
      </g>
    ),
  },
  pet_panda: {
    scale: 1,
    draw: () => (
      <g>
        {legs("#2a2440", [-13, 13], 12)}
        <P d={ell(0, -24, 22, 20)} fill="#fbfbff" />
        <P d={ell(-14, -22, 8, 11)} fill="#2a2440" sw={0} shade={false} />
        <P d={ell(14, -22, 8, 11)} fill="#2a2440" sw={0} shade={false} />
        <P d={circ(-9, -52, 7)} fill="#2a2440" sw={3} /><P d={circ(23, -52, 7)} fill="#2a2440" sw={3} />
        <P d={circ(7, -42, 16)} fill="#fbfbff" />
        <P d={ell(0, -42, 5.6, 7.6)} fill="#2a2440" sw={0} shade={false} transform="rotate(20 0 -42)" />
        <P d={ell(15, -42, 5.6, 7.6)} fill="#2a2440" sw={0} shade={false} transform="rotate(-20 15 -42)" />
        <circle cx={1} cy={-43} r={2} fill="#fff" /><circle cx={14} cy={-43} r={2} fill="#fff" />
        <path d="M 4 -35 h 6 l -3 3.4 Z" fill="#2a2440" />
        <path d="M 1 -31 Q 7 -26 13 -31" stroke="#1c1530" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      </g>
    ),
  },
  pet_fox: {
    scale: 1,
    draw: () => (
      <g>
        <P d="M -16 -20 C -46 -18 -48 -56 -30 -58 C -30 -44 -22 -34 -12 -30 Z" fill="#ff7a2e" />
        <P d="M -36 -50 C -44 -50 -46 -58 -38 -58 C -30 -58 -30 -52 -36 -50 Z" fill="#fff7ee" sw={2.6} shade={false} />
        {legs("#3b2a40", [-12, 12], 11)}
        <P d={ell(0, -21, 21, 14)} fill="#ff7a2e" />
        <P d={ell(10, -16, 10, 8)} fill="#fff7ee" sw={0} shade={false} />
        <P d={tri(5, -46, 9, -64, 19, -50)} fill="#ff7a2e" sw={3} />
        <P d={tri(19, -50, 28, -64, 29, -46)} fill="#ff7a2e" sw={3} />
        <path d="M 9 -58 L 10 -63 L 15 -56 Z M 26 -58 L 28 -63 L 28 -52 Z" fill="#3b2a40" />
        <P d="M 4 -40 Q 16 -54 32 -40 Q 30 -30 24 -28 L 14 -28 Q 6 -30 4 -40 Z" fill="#ff7a2e" />
        <P d="M 14 -28 Q 22 -28 26 -32 Q 30 -36 32 -40 L 34 -36 Q 32 -26 20 -24 Z" fill="#fff7ee" sw={2.4} shade={false} />
        {eye(14, -40)}{eye(24, -40)}
        <circle cx={32} cy={-38} r={2.6} fill="#1c1530" />
      </g>
    ),
  },
  pet_unicorn: {
    scale: 1.25,
    draw: () => (
      <g>
        <P d="M -20 -38 C -42 -34 -40 -8 -34 -4 C -32 -16 -26 -24 -16 -28 Z" fill="#ff8ad8" />
        {legs("#fbfbff", [-14, -6, 8, 16], 22)}
        <P d={ell(0, -34, 24, 15)} fill="#fbfbff" />
        <P d="M 12 -44 L 24 -66 L 34 -62 L 30 -38 Z" fill="#fbfbff" />
        <P d="M 18 -62 L 30 -64 L 36 -54 L 28 -42 L 16 -50 Z" fill="#fbfbff" />
        <P d="M 22 -60 L 29 -82 L 32 -60 Z" fill="#ffd24a" sw={2.6} />
        <P d="M 14 -62 C 4 -64 4 -44 12 -36 C 14 -46 18 -52 20 -58 Z" fill="#7be3ff" sw={3} />
        <P d="M 8 -52 C 0 -52 0 -36 6 -30 C 10 -38 12 -44 14 -50 Z" fill="#ff8ad8" sw={3} />
        {eye(25, -56, 2.4)}
        <circle cx={34} cy={-48} r={1.6} fill="#1c1530" />
      </g>
    ),
  },
  pet_dragon_baby: {
    scale: 1.2,
    draw: () => (
      <g>
        <P d="M -18 -22 C -42 -16 -48 -40 -34 -48 C -34 -38 -26 -32 -14 -30 Z" fill="#ff5a3d" />
        <path d="M -33 -48 l -6 -8 l 10 2 Z" fill="#ffd24a" stroke="#1c1530" strokeWidth={2.4} strokeLinejoin="round" />
        <P d="M -8 -34 C -30 -62 -40 -44 -30 -28 Z" fill="#ff9a3d" sw={3} />
        {legs("#ff5a3d", [-12, 12], 10)}
        <P d={ell(0, -22, 21, 16)} fill="#ff5a3d" />
        <P d={ell(4, -17, 12, 9)} fill="#ffd8a0" sw={0} shade={false} />
        <P d={tri(8, -50, 12, -66, 18, -52)} fill="#ffd24a" sw={2.8} />
        <P d={tri(20, -52, 28, -64, 28, -48)} fill="#ffd24a" sw={2.8} />
        <P d="M 4 -40 Q 10 -56 28 -50 Q 40 -44 36 -34 Q 28 -28 14 -28 Q 4 -30 4 -40 Z" fill="#ff5a3d" />
        {eye(18, -42)}
        <circle cx={33} cy={-38} r={1.6} fill="#1c1530" />
        <path d="M 16 -30 q 8 4 16 -2" stroke="#1c1530" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      </g>
    ),
  },
  pet_phoenix: {
    scale: 1.2,
    lift: 8,
    draw: () => (
      <g>
        <P d="M -14 -26 C -44 -10 -52 -50 -34 -62 C -34 -42 -26 -36 -12 -32 Z" fill="#ffb347" />
        <P d="M -12 -30 C -36 -2 -36 -34 -22 -44 C -22 -34 -16 -30 -10 -28 Z" fill="#ff5a3d" sw={3} />
        <P d="M -4 -40 C -24 -78 -48 -66 -42 -34 C -26 -40 -14 -40 -4 -40 Z" fill="#ff7a2e" sw={3} />
        <P d={ell(2, -28, 17, 20)} fill="#ff5a3d" />
        <P d={ell(6, -22, 10, 12)} fill="#ffd8a0" sw={0} shade={false} />
        <P d={circ(12, -52, 12)} fill="#ff5a3d" />
        <P d="M 8 -62 Q 10 -78 18 -80 Q 16 -70 18 -62 Z" fill="#ffd24a" sw={2.6} />
        <path d="M 22 -52 l 12 3 l -12 5 Z" fill="#ffd24a" stroke="#1c1530" strokeWidth={2.4} strokeLinejoin="round" />
        {eye(14, -54, 2.4)}
        {legs("#ffb347", [-3, 7], 6)}
      </g>
    ),
  },
  pet_lion_golden: {
    scale: 1.25,
    draw: () => (
      <g>
        <P d="M -22 -30 C -42 -26 -42 -6 -34 -4 C -34 -14 -28 -20 -18 -22 Z" fill="#e3a53a" />
        <circle cx={-36} cy={-6} r={6} fill="#8a4a1a" stroke="#1c1530" strokeWidth={2.6} />
        {legs("#e3a53a", [-14, -6, 8, 16], 16)}
        <P d={ell(0, -28, 24, 16)} fill="#e3a53a" />
        <P d={circ(18, -44, 19)} fill="#9a5a1e" />
        <P d={circ(20, -44, 12.5)} fill="#f2bf55" />
        <P d={circ(11, -58, 5)} fill="#9a5a1e" sw={3} /><P d={circ(28, -58, 5)} fill="#9a5a1e" sw={3} />
        <P d={ell(24, -38, 7, 5.4)} fill="#ffe7b8" sw={2.4} shade={false} />
        <path d="M 21 -42 h 6 l -3 3.4 Z" fill="#1c1530" />
        {eye(15, -48, 2.4)}{eye(27, -48, 2.4)}
      </g>
    ),
  },
  pet_dragon_ancient: {
    scale: 1.7,
    draw: () => (
      <g>
        <P d="M -20 -26 C -50 -20 -56 -52 -38 -60 C -38 -46 -28 -38 -16 -34 Z" fill="#4a2fa8" />
        <P d="M -4 -38 C -40 -86 -56 -48 -34 -22 Z" fill="#2a1d6e" sw={3} />
        <P d="M 2 -38 C -18 -88 -44 -66 -34 -34 Z" fill="#6a4be0" sw={3} />
        {legs("#4a2fa8", [-13, 13], 12)}
        <P d={ell(0, -24, 23, 18)} fill="#4a2fa8" />
        <P d={ell(4, -18, 13, 10)} fill="#b9a8ff" sw={0} shade={false} />
        {[-14, -6, 2].map((x) => <path key={x} d={`M ${x - 4} -40 l 4 -9 l 4 9 Z`} fill="#ffd24a" stroke="#1c1530" strokeWidth={2} strokeLinejoin="round" />)}
        <P d={tri(10, -54, 14, -74, 20, -56)} fill="#ffd24a" sw={2.8} />
        <P d={tri(22, -56, 32, -72, 30, -52)} fill="#ffd24a" sw={2.8} />
        <P d="M 4 -42 Q 10 -60 30 -54 Q 44 -48 40 -36 Q 32 -30 14 -30 Q 4 -32 4 -42 Z" fill="#4a2fa8" />
        <circle cx={20} cy={-45} r={3.2} fill="#7be3ff" stroke="#1c1530" strokeWidth={2} />
        <circle cx={37} cy={-40} r={1.6} fill="#1c1530" />
      </g>
    ),
  },
};

export const petOf = (id: string): PetArt | undefined => PETS[id];
