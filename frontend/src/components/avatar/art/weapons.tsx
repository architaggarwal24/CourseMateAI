"use client";
// The ten weapons, drawn in the hand's own space: (0, 0) is the middle of the gripping hand, the weapon points up.
import type { ReactNode } from "react";
import { L, P, circ, rr, tone } from "./primitives";

export interface WeaponArt {
  draw: () => ReactNode;
  /** x, y, w, h of the weapon on its own (for icons) */
  box: [number, number, number, number];
  /** one in each hand */
  twin?: boolean;
}

const sword = (blade: string, edge: string, guard: string, glow?: string): WeaponArt => ({
  twin: true,
  box: [-24, -104, 48, 130],
  draw: () => (
    <g>
      {glow && <path d="M -9 -4 L -9 -64 L 0 -92 L 9 -64 L 9 -4 Z" fill={glow} opacity={0.35} stroke={glow} strokeWidth={8} strokeLinejoin="round" />}
      <P d="M -7 -6 L -7 -66 L 0 -86 L 7 -66 L 7 -6 Z" fill={blade} />
      <L d="M 0 -80 V -10" color={edge} w={2.4} />
      <P d={rr(-16, -9, 32, 8, 3.5)} fill={guard} sw={3} />
      <P d={rr(-4, -2, 8, 22, 3)} fill="#4a2f4e" sw={3} />
      <P d={circ(0, 24, 5)} fill={guard} sw={3} />
    </g>
  ),
});

const staff = (pole: string, head: () => ReactNode, top = -104): WeaponArt => ({
  box: [-30, top - 30, 60, 160 - top + 30 - 30],
  draw: () => (
    <g>
      <P d={rr(-3.6, top + 10, 7.2, 140 - top, 3.6)} fill={pole} sw={3} />
      {head()}
    </g>
  ),
});

export const WEAPONS: Record<string, WeaponArt> = {
  weapon_pencil: {
    box: [-14, -96, 28, 130],
    draw: () => (
      <g>
        <P d="M -8 -62 L 8 -62 L 8 14 L -8 14 Z" fill="#f6c744" />
        <L d="M 0 -62 V 14" color="#c99a1f" w={2.2} />
        <P d="M -8 -62 L 0 -92 L 8 -62 Z" fill="#f1cf9b" sw={3} />
        <path d="M -3 -78 L 0 -92 L 3 -78 Z" fill="#2c2840" />
        <P d={rr(-9, 14, 18, 8, 2)} fill="#c5cde0" sw={2.6} />
        <P d={rr(-8, 22, 16, 12, 5)} fill="#ff8fa3" sw={3} />
      </g>
    ),
  },
  weapon_ruler: {
    box: [-14, -86, 28, 130],
    draw: () => (
      <g>
        <P d={rr(-10, -84, 20, 130, 3)} fill="#bfe3ff" />
        {Array.from({ length: 12 }, (_, i) => <L key={i} d={`M -10 ${-76 + i * 10} h ${i % 2 ? 6 : 10}`} w={1.8} />)}
        <L d="M 10 -84 V 46" color="#6aa9d8" w={3} />
      </g>
    ),
  },
  weapon_sword_bronze: sword("#e0aa66", "#b97d38", "#8a5a2b"),
  weapon_sword_silver: sword("#dfe6f5", "#a7b3cc", "#7c88a8"),
  weapon_sword_excalibur: sword("#e9fbff", "#9be6ff", "#ffd24a", "#7be3ff"),
  weapon_bow: {
    box: [-34, -92, 68, 190],
    draw: () => (
      <g>
        <L d="M -4 -86 Q -44 -28 -4 40" color="#1c1530" w={10} />
        <L d="M -4 -86 Q -44 -28 -4 40" color="#a6713a" w={5.4} />
        <L d="M -4 -86 L -4 40" color="#eef1f8" w={1.8} />
        <P d={rr(-9, -12, 10, 20, 4)} fill="#5a3a1e" sw={2.6} />
        <path d="M -4 -30 L 36 -30 M 30 -35 L 38 -30 L 30 -25" stroke="#1c1530" strokeWidth={3.2} fill="none" strokeLinecap="round" opacity={0} />
      </g>
    ),
  },
  weapon_staff_wood: staff("#8a5a2b", () => (
    <g>
      <P d="M -4 -86 Q -22 -96 -16 -118 Q -8 -104 0 -100 Q 8 -104 16 -118 Q 22 -96 4 -86 Z" fill="#6b4220" sw={3} />
      <P d={circ(0, -104, 9)} fill="#ff8a3d" />
      <circle cx={-3} cy={-107} r={3} fill="#fff1c9" />
    </g>
  ), -118),
  weapon_hammer: {
    box: [-34, -92, 68, 140],
    draw: () => (
      <g>
        <P d={rr(-3.8, -64, 7.6, 118, 3.6)} fill="#8a5a2b" sw={3} />
        <P d={rr(-30, -92, 60, 34, 7)} fill="#aeb8d0" />
        <P d={rr(-34, -88, 10, 26, 4)} fill="#7c88a8" sw={3} />
        <P d={rr(24, -88, 10, 26, 4)} fill="#7c88a8" sw={3} />
        <path d="M 2 -86 L -6 -73 L 1 -73 L -3 -62 L 8 -77 L 1 -77 Z" fill="#ffe34a" stroke="#1c1530" strokeWidth={1.8} strokeLinejoin="round" />
        <P d={rr(-5, 44, 10, 10, 3)} fill="#5a3a1e" sw={2.6} />
      </g>
    ),
  },
  weapon_staff_crystal: staff("#a9b6d6", () => (
    <g>
      <P d="M -12 -86 Q 0 -78 12 -86 L 8 -94 L -8 -94 Z" fill="#7c88a8" sw={3} />
      <P d="M 0 -138 L 15 -112 L 9 -92 L -9 -92 L -15 -112 Z" fill="#6fe0ff" />
      <L d="M 0 -136 V -94 M -14 -112 H 14" color="#e9fbff" w={2} opacity={0.8} />
    </g>
  ), -130),
  weapon_staff_legendary: staff("#2a2440", () => (
    <g>
      <P d="M -14 -86 Q 0 -74 14 -86 L 10 -98 L -10 -98 Z" fill="#c2253d" sw={3} />
      <P d="M 0 -150 C 22 -130 22 -104 0 -92 C -22 -104 -22 -130 0 -150 Z" fill="#ff7a1c" />
      <path d="M 0 -136 C 11 -124 11 -108 0 -100 C -11 -108 -11 -124 0 -136 Z" fill="#ffe08a" />
      <P d="M -26 -108 L -14 -112 L -18 -98 Z" fill="#c2253d" sw={2.6} />
      <P d="M 26 -108 L 14 -112 L 18 -98 Z" fill="#c2253d" sw={2.6} />
    </g>
  ), -140),
};

export const weaponOf = (id: string): WeaponArt | undefined => WEAPONS[id];
export { tone };
