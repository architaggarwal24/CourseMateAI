"use client";
// Potion bottles for the consumables, drawn small (icons only; they are never worn).
import type { ReactNode } from "react";
import { L, P, circ, rr } from "./primitives";

const bottle = (liquid: string, glyph: ReactNode, shape: "round" | "tall" = "round"): ReactNode => (
  <g>
    <P d={rr(-8, -34, 16, 10, 3)} fill="#a6713a" sw={3} />
    <P d={rr(-6, -26, 12, 10, 2)} fill="#dff4ff" sw={3} shade={false} opacity={0.9} />
    {shape === "round"
      ? <P d="M -6 -18 Q -26 -6 -22 10 Q -18 26 0 26 Q 18 26 22 10 Q 26 -6 6 -18 Z" fill="#dff4ff" sw={3.4} shade={false} />
      : <P d="M -9 -18 L -13 20 Q -13 26 -7 26 H 7 Q 13 26 13 20 L 9 -18 Z" fill="#dff4ff" sw={3.4} shade={false} />}
    {shape === "round"
      ? <path d="M -18 2 Q -22 12 -16 20 Q -8 24 0 24 Q 12 24 18 18 Q 22 10 18 2 Z" fill={liquid} />
      : <path d="M -11 2 L -12.4 20 Q -12 24 -7 24 H 7 Q 12 24 12.4 20 L 11 2 Z" fill={liquid} />}
    <L d="M -14 -2 Q -18 6 -14 14" color="#ffffff" w={3} opacity={0.7} />
    <g transform="translate(0 10)">{glyph}</g>
  </g>
);

const heart = <path d="M 0 6 C -12 -2 -8 -12 0 -6 C 8 -12 12 -2 0 6 Z" fill="#fff" opacity={0.9} />;
const spark = <path d="M 0 -8 L 2.6 -2.6 L 8 0 L 2.6 2.6 L 0 8 L -2.6 2.6 L -8 0 L -2.6 -2.6 Z" fill="#fff" opacity={0.92} />;
const coin = <g><circle r={6} fill="#fff" opacity={0.9} /><L d="M 0 -3 V 3" color="#c99a1f" w={2} /></g>;
const hourglass = <path d="M -5 -7 H 5 L 1 0 L 5 7 H -5 L -1 0 Z" fill="#fff" opacity={0.92} />;
const vortex = <g><L d="M -6 0 a 6 6 0 1 1 6 6" color="#fff" w={2.4} /><L d="M -3 0 a 3 3 0 1 1 3 3" color="#fff" w={2.4} /></g>;
const duality = <g><circle cx={-3.5} r={5} fill="#fff" opacity={0.85} /><circle cx={3.5} r={5} fill="#fff" opacity={0.45} /></g>;

export const POTIONS: Record<string, ReactNode> = {
  potion_health_small: bottle("#ff4d6d", heart),
  fifty_fifty: bottle("#8a6cff", duality, "tall"),
  potion_xp_boost: bottle("#39d98a", spark),
  potion_coin_boost: bottle("#ffc233", coin, "tall"),
  potion_streak_shield: bottle("#46c7ff", hourglass),
  potion_xp_boost_2h: bottle("#b06cff", spark, "tall"),
  potion_quest_reset: bottle("#ff8a3d", vortex),
};
export const POTION_BOX: [number, number, number, number] = [-28, -40, 56, 72];
export { circ };
