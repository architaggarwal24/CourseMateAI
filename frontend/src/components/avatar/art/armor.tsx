"use client";
// The twelve outfits. Each draws over the bare body in the same silhouette (torsoPath / legPath), so every outfit fits
// every body type. `back` sits behind the hero (capes), `front` over the arms (shoulder plates).
import type { ReactNode } from "react";
import type { BodyParams, SkinTone } from "@/lib/avatar/look";
import { CX, HIP_Y, Shoes, legPath, legX, torsoPath } from "./body";
import { L, P, circ, ell, rr, tone } from "./primitives";

export interface OutfitCtx { b: BodyParams; skin: SkinTone }
export interface Outfit {
  sleeve?: { color: string; len: number; cuff?: string };
  back?: (c: OutfitCtx) => ReactNode;
  legs?: (c: OutfitCtx) => ReactNode;
  torso?: (c: OutfitCtx) => ReactNode;
  front?: (c: OutfitCtx) => ReactNode;
  /** shoe colour; omitted = plain trainers */
  shoes?: string;
  /** feet are hidden by the outfit (long robes) */
  hideFeet?: boolean;
}

const pants = (b: BodyParams, color: string, bottom = 256, widen = 0) => (
  <g>
    {(["L", "R"] as const).map((s) => {
      const x = legX(b, s) - (s === "L" ? widen : 0);
      return <P key={s} d={rr(x - 1, HIP_Y - 10, b.leg + 2 + widen, bottom - (HIP_Y - 10), 7)} fill={color} />;
    })}
    <L d={`M ${CX} ${HIP_Y} V ${bottom - 14}`} w={2.5} opacity={0.5} />
  </g>
);

const hem = (b: BodyParams, color: string, y = HIP_Y) => (
  <P d={rr(CX - b.hw / 2 - 2, y - 8, b.hw + 4, 11, 4)} fill={color} sw={2.5} />
);

const shoulder = (b: BodyParams, side: 1 | -1) => ({ x: CX + side * (b.sw / 2 - 2), y: 154 });

function scales(b: BodyParams, color: string, light: string) {
  const out: ReactNode[] = [];
  for (let row = 0; row < 7; row++) {
    const y = 156 + row * 8.5;
    const half = row < 3 ? b.sw / 2 - 6 - row * 1 : b.ww / 2 + 3 + (row - 3) * 2;
    for (let x = CX - half + 4; x < CX + half - 2; x += 9) {
      const px = x + (row % 2 ? 4.5 : 0);
      if (Math.abs(px - CX) < half) out.push(<path key={`${row}-${x}`} d={`M ${px - 4.5} ${y} Q ${px} ${y + 9} ${px + 4.5} ${y}`} fill="none" stroke={row % 2 ? light : color} strokeWidth={2.2} strokeLinecap="round" />);
    }
  }
  return out;
}

export const OUTFITS: Record<string, Outfit> = {
  armor_gi_white: {
    sleeve: { color: "#f4f1fb", len: 34, cuff: "#f4f1fb" },
    shoes: "#2a2340",
    legs: ({ b }) => pants(b, "#f4f1fb", 250, 3),
    torso: ({ b }) => (
      <g>
        <P d={torsoPath(b)} fill="#f4f1fb" />
        <L d={`M ${CX - 14} 146 L ${CX + 8} 196`} w={3} />
        <L d={`M ${CX + 14} 146 L ${CX - 8} 196`} w={3} />
        <P d={rr(CX - b.ww / 2 - 2, 190, b.ww + 4, 11, 3)} fill="#26203a" sw={2.5} />
        <P d={rr(CX - 6, 190, 12, 22, 3)} fill="#26203a" sw={2.5} />
      </g>
    ),
  },
  armor_gi_red: {
    shoes: "#2a2340",
    legs: ({ b }) => pants(b, "#d6313c", 252, 4),
    torso: ({ b }) => <g><P d={rr(CX - b.ww / 2 - 2, 188, b.ww + 4, 14, 4)} fill="#ff8fb1" sw={2.5} /><P d={rr(CX + 4, 196, 8, 22, 3)} fill="#ff8fb1" sw={2.5} /></g>,
  },
  armor_gi_blue: {
    shoes: "#2a2340",
    legs: ({ b }) => pants(b, "#2f5fd6", 252, 4),
    torso: ({ b }) => <g><P d={rr(CX - b.ww / 2 - 2, 188, b.ww + 4, 14, 4)} fill="#ffcf5d" sw={2.5} /><P d={rr(CX + 4, 196, 8, 22, 3)} fill="#ffcf5d" sw={2.5} /></g>,
  },
  armor_shirt_basic: {
    sleeve: { color: "#eef1f8", len: 26 },
    legs: ({ b }) => <g>{pants(b, "#3d62ad", 258)}<L d={`M ${CX - b.leg - 2} 244 H ${CX - 4} M ${CX + 4} 244 H ${CX + b.leg + 2}`} w={2.5} opacity={0.4} /></g>,
    torso: ({ b }) => (
      <g>
        <P d={torsoPath(b, -6)} fill="#eef1f8" />
        <L d={`M ${CX - 12} 146 Q ${CX} 158 ${CX + 12} 146`} w={3} />
        <P d={rr(CX - b.hw / 2 - 1, 200, b.hw + 2, 10, 3)} fill="#2b2a3f" sw={2.5} />
        <P d={rr(CX - 5, 200, 10, 10, 2)} fill="#f2c14e" sw={2} />
      </g>
    ),
  },
  armor_hoodie_gray: {
    sleeve: { color: "#8e94a8", len: 58, cuff: "#767c91" },
    shoes: "#272435",
    legs: ({ b }) => pants(b, "#5a6076", 258),
    torso: ({ b }) => (
      <g>
        <P d={torsoPath(b, 4)} fill="#8e94a8" />
        <P d={`M ${CX - 28} 144 Q ${CX} 164 ${CX + 28} 144 Q ${CX + 30} 136 ${CX + 18} 134 Q ${CX} 146 ${CX - 18} 134 Q ${CX - 30} 136 ${CX - 28} 144 Z`} fill="#767c91" />
        <P d={rr(CX - b.ww / 2 + 2, 190, b.ww - 4, 18, 5)} fill="#7a8096" sw={2.5} />
        <L d={`M ${CX - 9} 152 V 176 M ${CX + 9} 152 V 176`} color="#eceef7" w={2.6} />
        <P d={rr(CX - b.hw / 2, 208, b.hw, 8, 3)} fill="#767c91" sw={2.5} />
      </g>
    ),
  },
  armor_robe_blue: {
    sleeve: { color: "#2f56c4", len: 56, cuff: "#f2c14e" },
    hideFeet: true,
    legs: ({ b }) => <g>{pants(b, "#2a3f8a", 258)}</g>,
    torso: ({ b }) => (
      <g>
        <P d={`M ${CX - b.sw / 2 + 6} 146 Q ${CX} 138 ${CX + b.sw / 2 - 6} 146 L ${CX + b.hw / 2 + 12} 254 Q ${CX} 262 ${CX - b.hw / 2 - 12} 254 Z`} fill="#2f56c4" />
        <P d={`M ${CX - 5} 146 L ${CX - 7} 256 L ${CX + 7} 256 L ${CX + 5} 146 Z`} fill="#f2c14e" sw={2.5} />
        <P d={rr(CX - b.ww / 2 - 2, 186, b.ww + 4, 10, 3)} fill="#f2c14e" sw={2.5} />
        <L d={`M ${CX - b.hw / 2 - 12} 252 Q ${CX} 260 ${CX + b.hw / 2 + 12} 252`} color="#f2c14e" w={4} />
      </g>
    ),
  },
  armor_jacket_cool: {
    sleeve: { color: "#2a2834", len: 60, cuff: "#3d3a4c" },
    shoes: "#15131d",
    legs: ({ b }) => <g>{pants(b, "#3b3b4d", 262)}</g>,
    torso: ({ b }) => (
      <g>
        <P d={torsoPath(b, 2)} fill="#2a2834" />
        <P d={`M ${CX - 14} 146 L ${CX} 176 L ${CX + 14} 146 Z`} fill="#eef1f8" sw={2.5} />
        <L d={`M ${CX} 176 V 216`} color="#c9cde0" w={2.5} />
        <P d={`M ${CX - 20} 144 L ${CX - 2} 178 L ${CX - 24} 164 Z`} fill="#3d3a4c" sw={2.5} />
        <P d={`M ${CX + 20} 144 L ${CX + 2} 178 L ${CX + 24} 164 Z`} fill="#3d3a4c" sw={2.5} />
        <L d={`M ${CX - b.ww / 2 + 4} 200 H ${CX - 6} M ${CX + 6} 200 H ${CX + b.ww / 2 - 4}`} color="#c9cde0" w={2.5} />
      </g>
    ),
    front: ({ b }) => <g>{[-1, 1].map((s) => { const p = shoulder(b, s as 1 | -1); return <circle key={s} cx={p.x - s * 6} cy={p.y - 2} r={2.6} fill="#c9cde0" stroke="#1c1530" strokeWidth={1.8} />; })}</g>,
  },
  armor_wizard_purple: {
    sleeve: { color: "#6b3fc4", len: 56, cuff: "#f2c14e" },
    hideFeet: true,
    legs: ({ b }) => pants(b, "#4a2a94", 258),
    torso: ({ b }) => (
      <g>
        <P d={`M ${CX - b.sw / 2 + 6} 146 Q ${CX} 138 ${CX + b.sw / 2 - 6} 146 L ${CX + b.hw / 2 + 14} 254 Q ${CX} 264 ${CX - b.hw / 2 - 14} 254 Z`} fill="#6b3fc4" />
        <P d={`M ${CX - 22} 144 Q ${CX} 160 ${CX + 22} 144 L ${CX + 26} 156 Q ${CX} 176 ${CX - 26} 156 Z`} fill="#f2c14e" sw={2.5} />
        <path d={`M ${CX} 176 l 4.5 9 l 10 1.4 l -7.2 7 l 1.8 10 l -9.1 -4.8 l -9.1 4.8 l 1.8 -10 l -7.2 -7 l 10 -1.4 Z`} fill="#ffe08a" stroke="#1c1530" strokeWidth={2.2} strokeLinejoin="round" />
        <L d={`M ${CX - 24} 236 l 5 -6 l 5 6 M ${CX + 14} 236 l 5 -6 l 5 6`} color="#f2c14e" w={2.6} />
        <L d={`M ${CX - b.hw / 2 - 14} 252 Q ${CX} 262 ${CX + b.hw / 2 + 14} 252`} color="#f2c14e" w={4} />
      </g>
    ),
  },
  armor_knight_silver: {
    sleeve: { color: "#8b93a8", len: 60, cuff: "#c5cde0" },
    shoes: "#6d7589",
    legs: ({ b }) => <g>{pants(b, "#aab3c8", 252)}{(["L", "R"] as const).map((s) => <P key={s} d={rr(legX(b, s) - 2, 222, b.leg + 4, 14, 5)} fill="#d4dbec" sw={2.5} />)}</g>,
    torso: ({ b }) => (
      <g>
        <P d={torsoPath(b)} fill="#b7c0d6" />
        <P d={`M ${CX - b.ww / 2 + 2} 158 Q ${CX} 176 ${CX + b.ww / 2 - 2} 158 L ${CX + b.ww / 2 - 4} 186 Q ${CX} 196 ${CX - b.ww / 2 + 4} 186 Z`} fill="#dfe5f5" sw={2.5} />
        <L d={`M ${CX} 160 V 192`} w={2.5} opacity={0.5} />
        <P d={rr(CX - b.hw / 2 - 1, 198, b.hw + 2, 14, 4)} fill="#7e879c" sw={2.5} />
      </g>
    ),
    front: ({ b }) => <g>{[-1, 1].map((s) => { const p = shoulder(b, s as 1 | -1); return (
      <g key={s}>
        <P d={`M ${p.x - 18} ${p.y + 6} Q ${p.x} ${p.y - 24} ${p.x + 18} ${p.y + 6} Q ${p.x} ${p.y + 12} ${p.x - 18} ${p.y + 6} Z`} fill="#dfe5f5" />
        <P d={`M ${p.x - 4} ${p.y - 14} L ${p.x + s * 4} ${p.y - 34} L ${p.x + 6} ${p.y - 12} Z`} fill="#8b93a8" sw={2.6} />
      </g>); })}</g>,
  },
  armor_knight_gold: {
    sleeve: { color: "#c99a2e", len: 60, cuff: "#ffd978" },
    shoes: "#b8862a",
    back: ({ b }) => <P d={`M ${CX - b.sw / 2 + 4} 150 L ${CX - b.hw / 2 - 22} 268 Q ${CX} 280 ${CX + b.hw / 2 + 22} 268 L ${CX + b.sw / 2 - 4} 150 Z`} fill="#c2253d" />,
    legs: ({ b }) => <g>{pants(b, "#e0b04a", 252)}{(["L", "R"] as const).map((s) => <P key={s} d={rr(legX(b, s) - 2, 222, b.leg + 4, 14, 5)} fill="#ffe08a" sw={2.5} />)}</g>,
    torso: ({ b }) => (
      <g>
        <P d={torsoPath(b)} fill="#e7b947" />
        <P d={`M ${CX - b.ww / 2 + 2} 158 Q ${CX} 176 ${CX + b.ww / 2 - 2} 158 L ${CX + b.ww / 2 - 4} 186 Q ${CX} 196 ${CX - b.ww / 2 + 4} 186 Z`} fill="#ffe08a" sw={2.5} />
        <circle cx={CX} cy={174} r={8} fill="#ff9d2e" stroke="#1c1530" strokeWidth={2.4} />
        <L d={`M ${CX} 162 V 186 M ${CX - 12} 174 H ${CX + 12}`} color="#ffe08a" w={2.2} />
        <P d={rr(CX - b.hw / 2 - 1, 198, b.hw + 2, 14, 4)} fill="#a8761f" sw={2.5} />
      </g>
    ),
    front: ({ b }) => <g>{[-1, 1].map((s) => { const p = shoulder(b, s as 1 | -1); return (
      <P key={s} d={`M ${p.x - 20} ${p.y + 8} Q ${p.x} ${p.y - 28} ${p.x + 20} ${p.y + 8} Q ${p.x} ${p.y + 14} ${p.x - 20} ${p.y + 8} Z`} fill="#ffe08a" />); })}</g>,
  },
  armor_dragon_scale: {
    sleeve: { color: "#b93a22", len: 60, cuff: "#ffb347" },
    shoes: "#6e1d12",
    legs: ({ b }) => <g>{pants(b, "#c2432a", 256)}</g>,
    torso: ({ b }) => (
      <g>
        <P d={torsoPath(b)} fill="#d9482b" />
        {scales(b, "#8f2412", "#ff9a6a")}
        <P d={rr(CX - b.hw / 2 - 1, 198, b.hw + 2, 14, 4)} fill="#4a1a12" sw={2.5} />
        <path d={`M ${CX - 7} 200 h14 v8 q-7 7 -14 0 Z`} fill="#ffe08a" stroke="#1c1530" strokeWidth={2} strokeLinejoin="round" />
      </g>
    ),
    front: ({ b }) => <g>{[-1, 1].map((s) => { const p = shoulder(b, s as 1 | -1); return (
      <g key={s}>
        <P d={`M ${p.x - 16} ${p.y + 8} Q ${p.x} ${p.y - 18} ${p.x + 16} ${p.y + 8} Z`} fill="#a62f1a" />
        <P d={`M ${p.x + s * 2 - 5} ${p.y - 8} Q ${p.x + s * 8} ${p.y - 36} ${p.x + s * 16} ${p.y - 42} Q ${p.x + s * 14} ${p.y - 24} ${p.x + s * 8 + 5} ${p.y - 8} Z`} fill="#ffd9a0" sw={2.6} />
      </g>); })}</g>,
  },
  armor_legends_mantle: {
    sleeve: { color: "#2c2a78", len: 58, cuff: "#7be3ff" },
    shoes: "#1b1a4a",
    back: ({ b }) => (
      <g>
        <P d={`M ${CX - b.sw / 2 - 2} 148 Q ${CX - b.hw / 2 - 34} 230 ${CX - b.hw / 2 - 18} 278 Q ${CX} 262 ${CX + b.hw / 2 + 18} 278 Q ${CX + b.hw / 2 + 34} 230 ${CX + b.sw / 2 + 2} 148 Z`} fill="#4a2fa8" />
        {[[-52, 220], [-40, 252], [50, 226], [42, 256], [-28, 270], [30, 272]].map(([x, y], i) => <circle key={i} cx={CX + x} cy={y} r={2.2} fill="#ffe9a8" />)}
      </g>
    ),
    legs: ({ b }) => pants(b, "#26246a", 256),
    torso: ({ b }) => (
      <g>
        <P d={torsoPath(b)} fill="#2c2a78" />
        <L d={`M ${CX - b.ww / 2 + 2} 160 Q ${CX} 180 ${CX + b.ww / 2 - 2} 160`} color="#7be3ff" w={3.2} />
        <path d={`M ${CX} 168 l 3.6 7.4 l 8 1.2 l -5.8 5.6 l 1.4 8 l -7.2 -3.8 l -7.2 3.8 l 1.4 -8 l -5.8 -5.6 l 8 -1.2 Z`} fill="#ffe9a8" stroke="#1c1530" strokeWidth={2} strokeLinejoin="round" />
        <P d={rr(CX - b.hw / 2 - 1, 198, b.hw + 2, 12, 4)} fill="#f2c14e" sw={2.5} />
      </g>
    ),
    front: ({ b }) => <g>{[-1, 1].map((s) => { const p = shoulder(b, s as 1 | -1); return (
      <g key={s}><P d={ell(p.x, p.y + 2, 16, 11)} fill="#f2c14e" /><circle cx={p.x} cy={p.y + 2} r={4} fill="#7be3ff" stroke="#1c1530" strokeWidth={2} /></g>); })}</g>,
  },
};

export const outfitOf = (id: string): Outfit => OUTFITS[id] ?? OUTFITS.armor_shirt_basic;
export { circ, legPath, Shoes, tone };
