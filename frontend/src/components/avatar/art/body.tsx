"use client";
// The bare hero: legs, torso, arms, head, face and hair. Outfits, hats and weapons are drawn over this.
import type { ReactNode } from "react";
import type { BodyParams, EyeColor, HairColor, LipColor, SkinTone } from "@/lib/avatar/look";
import { L, OL, P, SW, circ, ell, rr, tone } from "./primitives";

export const CX = 100;
export const SHOULDER_Y = 150;
export const HIP_Y = 214;
export const GROUND_Y = 272;

export type Expression = "idle" | "happy" | "shout" | "hurt" | "sad";

export interface Tints { skin: SkinTone; hair: HairColor; eye: EyeColor; lip: LipColor }

// ── silhouette paths (also used by outfits, so clothes always match the body) ───────────────────────────────────
export function torsoPath(b: BodyParams, drop = 0): string {
  const sw = b.sw / 2, ww = b.ww / 2, hw = b.hw / 2;
  const top = 146, waist = 184, hip = HIP_Y + drop;
  return `M ${CX - sw + 8} ${top} Q ${CX} ${top - 7} ${CX + sw - 8} ${top} Q ${CX + sw} ${top + 2} ${CX + sw - 2} ${top + 14}`
    + ` L ${CX + ww} ${waist} Q ${CX + hw + 1} ${waist + 16} ${CX + hw} ${hip}`
    + ` L ${CX - hw} ${hip} Q ${CX - hw - 1} ${waist + 16} ${CX - ww} ${waist}`
    + ` L ${CX - sw + 2} ${top + 14} Q ${CX - sw} ${top + 2} ${CX - sw + 8} ${top} Z`;
}

/** One leg from the hip down to the ankle (x = left edge of the leg). */
export function legPath(b: BodyParams, side: "L" | "R", bottom = 262): string {
  const gap = 4, w = b.leg;
  const x = side === "L" ? CX - gap / 2 - w : CX + gap / 2;
  return rr(x, HIP_Y - 8, w, bottom - (HIP_Y - 8), 7);
}
export const legX = (b: BodyParams, side: "L" | "R") => (side === "L" ? CX - 2 - b.leg : CX + 2);

export function Legs({ b, skin, children }: { b: BodyParams; skin: SkinTone; children?: ReactNode }) {
  return (
    <g>
      <P d={legPath(b, "L")} fill={skin.m} />
      <P d={legPath(b, "R")} fill={skin.m} />
      {children}
    </g>
  );
}

export function Shoes({ b, color, sole = "#efe8ff" }: { b: BodyParams; color: string; sole?: string }) {
  const shoe = (side: "L" | "R") => {
    const x = legX(b, side), w = b.leg + 6, out = side === "L" ? -6 : 0;
    return (
      <g key={side}>
        <P d={`M ${x + out} 258 H ${x + out + w} Q ${x + out + w + 3} 258 ${x + out + w + 3} 266 Q ${x + out + w + 3} ${GROUND_Y} ${x + out + w - 3} ${GROUND_Y} H ${x + out + 2} Q ${x + out - 3} ${GROUND_Y} ${x + out - 3} 265 Q ${x + out - 3} 258 ${x + out} 258 Z`} fill={color} />
        <L d={`M ${x + out - 2} 268 H ${x + out + w + 2}`} color={sole} w={3} />
      </g>
    );
  };
  return <g>{shoe("L")}{shoe("R")}</g>;
}

export function Torso({ b, skin }: { b: BodyParams; skin: SkinTone }) {
  return (
    <g>
      <P d={rr(CX - 10, 124, 20, 30, 6)} fill={skin.d} />
      <P d={torsoPath(b)} fill={skin.b} />
      {b.female && <L d={`M ${CX - 8} 160 Q ${CX} 166 ${CX + 8} 160`} color={tone(skin.d, -0.2)} w={2} opacity={0.5} />}
    </g>
  );
}

/** An arm hanging from (0,0): swing it by rotating the group it sits in. `sleeve` is how far down clothing reaches. */
export function Arm({ b, skin, sleeve, held }: { b: BodyParams; skin: SkinTone; sleeve?: { color: string; len: number; cuff?: string }; held?: ReactNode }) {
  const a = b.arm, h = a / 2;
  const limb = `M ${-h} 0 L ${-h} 50 Q ${-h} 62 0 62 Q ${h} 62 ${h} 50 L ${h} 0 Q ${h} -7 0 -7 Q ${-h} -7 ${-h} 0 Z`;
  return (
    <g>
      <P d={limb} fill={skin.b} />
      {sleeve && sleeve.len > 0 && (
        <>
          <P d={rr(-h - 2, -8, a + 4, sleeve.len + 8, 6)} fill={sleeve.color} />
          {sleeve.cuff && <P d={rr(-h - 3, sleeve.len - 4, a + 6, 7, 3)} fill={sleeve.cuff} sw={2.5} />}
        </>
      )}
      <P d={circ(0, 64, h + 2.5)} fill={skin.b} />
      {held}
    </g>
  );
}

// ── head ────────────────────────────────────────────────────────────────────────────────────────────────────
const HEAD: Record<BodyParams["head"], string> = {
  male: "M 50 84 C 50 52 72 38 100 38 C 128 38 150 52 150 84 C 150 108 130 130 100 130 C 70 130 50 108 50 84 Z",
  female: "M 54 84 C 54 54 74 38 100 38 C 126 38 146 54 146 84 C 146 110 126 132 100 132 C 74 132 54 110 54 84 Z",
  sporty: "M 53 84 C 53 53 73 38 100 38 C 127 38 147 53 147 84 C 147 109 127 131 100 131 C 73 131 53 109 53 84 Z",
};

export function HairBack({ b, hair }: { b: BodyParams; hair: HairColor }) {
  if (b.head === "female") {
    return (
      <g>
        <P d="M 48 78 C 36 130 34 186 52 220 C 70 228 130 228 148 220 C 166 186 164 130 152 78 Z" fill={hair.c} />
        <L d="M 58 120 Q 54 170 62 206 M 142 120 Q 146 170 138 206" color={hair.h} w={3} opacity={0.55} />
      </g>
    );
  }
  if (b.head === "sporty") {
    return (
      <g>
        <P d="M 138 54 C 178 40 196 96 172 142 C 166 122 160 104 148 92 Z" fill={hair.c} />
        <L d="M 160 70 Q 178 98 168 128" color={hair.h} w={3} opacity={0.6} />
      </g>
    );
  }
  return null;
}

export function Head({ b, skin }: { b: BodyParams; skin: SkinTone }) {
  return (
    <g>
      <P d={ell(51, 94, 7, 11)} fill={skin.m} />
      <P d={ell(149, 94, 7, 11)} fill={skin.m} />
      <P d={HEAD[b.head]} fill={skin.b} />
    </g>
  );
}

export function HairFront({ b, hair }: { b: BodyParams; hair: HairColor }) {
  if (b.head === "female") {
    return (
      <g>
        <P d="M 46 86 C 38 46 68 26 100 26 C 134 26 162 46 154 86 C 150 70 142 62 128 58 C 116 76 86 74 72 56 C 58 62 50 74 46 86 Z" fill={hair.c} />
        <L d="M 84 40 Q 100 34 120 40 M 94 52 Q 112 46 128 56" color={hair.h} w={3.5} opacity={0.7} />
      </g>
    );
  }
  if (b.head === "sporty") {
    return (
      <g>
        <P d="M 47 84 C 42 46 70 28 100 28 C 132 28 158 46 153 84 C 148 66 138 58 124 60 C 112 70 88 70 76 58 C 62 60 52 70 47 84 Z" fill={hair.c} />
        <P d={rr(138, 56, 14, 9, 4)} fill="#ff5d73" sw={2.5} />
        <L d="M 84 40 Q 100 35 118 40" color={hair.h} w={3.5} opacity={0.7} />
      </g>
    );
  }
  return (
    <g>
      <P d="M 47 82 C 42 44 68 28 100 28 C 134 28 160 44 153 82 C 148 66 136 56 122 62 C 110 50 90 52 78 62 C 64 56 52 66 47 82 Z" fill={hair.c} />
      <P d="M 122 62 C 130 50 148 54 153 82 C 146 68 136 62 122 62 Z" fill={tone(hair.c, -0.18)} sw={0} shade={false} opacity={0.6} />
      <L d="M 82 40 Q 100 33 122 40 M 70 52 Q 78 46 90 46" color={hair.h} w={3.5} opacity={0.7} />
    </g>
  );
}

export function Face({ b, tints, expression = "idle" }: { b: BodyParams; tints: Tints; expression?: Expression }) {
  const { skin, hair, eye, lip } = tints;
  const brow = tone(hair.c, -0.15);
  const eyeAt = (x: number) => {
    if (expression === "hurt") {
      const d = x < CX ? 1 : -1;
      return <L key={x} d={`M ${x - 8 * d} 86 L ${x + 5 * d} 92 L ${x - 8 * d} 98`} w={3.6} />;
    }
    if (expression === "happy") return <L key={x} d={`M ${x - 9} 94 Q ${x} 82 ${x + 9} 94`} w={3.8} />;
    if (expression === "sad") {
      return (
        <g key={x}>
          <P d={ell(x, 93, 7.5, 8)} fill="#fff" sw={2.5} shade={false} />
          <circle cx={x} cy={95} r={5.2} fill={eye.iris} /><circle cx={x} cy={95} r={2.6} fill={eye.pupil} />
          <circle cx={x - 2} cy={92.5} r={1.8} fill="#fff" />
        </g>
      );
    }
    return (
      <g key={x}>
        <P d={ell(x, 92, 8, 10)} fill="#fff" sw={2.5} shade={false} />
        <circle cx={x} cy={93} r={6.4} fill={eye.iris} />
        <circle cx={x} cy={93} r={3.3} fill={eye.pupil} />
        <circle cx={x - 2.4} cy={89.6} r={2.2} fill="#fff" />
        <circle cx={x + 2.6} cy={96.4} r={1} fill="#fff" opacity={0.8} />
        <L d={`M ${x - 9} 86 Q ${x} 79 ${x + 9} 86`} w={3} />
        {b.female && <L d={`M ${x + (x < CX ? -9 : 9)} 86 l ${x < CX ? -4 : 4} -3`} w={2.4} />}
      </g>
    );
  };
  const mouth = () => {
    if (expression === "shout") return <P d="M 88 108 Q 100 106 112 108 Q 112 124 100 124 Q 88 124 88 108 Z" fill="#6b1020" sw={2.8} shade={false} />;
    if (expression === "hurt") return <L d="M 90 118 Q 95 111 100 118 Q 105 125 110 118" w={3} />;
    if (expression === "sad") return <L d="M 91 119 Q 100 111 109 119" w={3} />;
    if (expression === "happy") return <P d="M 88 108 Q 100 126 112 108 Z" fill={lip.color} sw={2.8} shade={false} />;
    return b.female
      ? <><L d="M 91 112 Q 100 119 109 112" w={3} /><path d="M 93 112.5 Q 100 117 107 112.5 Q 100 116 93 112.5 Z" fill={lip.color} stroke={lip.color} strokeWidth={2} /></>
      : <L d="M 91 112 Q 100 119 109 112" w={3} />;
  };
  const dy = expression === "hurt" ? 3 : 0;
  return (
    <g>
      {/* brows */}
      <L d={`M 70 ${75 + dy} Q 82 ${69 + dy} 93 ${75 + dy}`} color={brow} w={4} />
      <L d={`M 107 ${75 + dy} Q 118 ${69 + dy} 130 ${75 + dy}`} color={brow} w={4} />
      {expression === "shout" && <><L d="M 70 70 L 92 78" color={brow} w={4.4} /><L d="M 130 70 L 108 78" color={brow} w={4.4} /></>}
      {eyeAt(82)}{eyeAt(118)}
      {/* nose and blush */}
      <L d="M 98 102 Q 100 105 103 103" color={tone(skin.d, -0.1)} w={2.4} />
      <ellipse cx={68} cy={106} rx={8} ry={5} fill="#ff6f91" opacity={0.28} />
      <ellipse cx={132} cy={106} rx={8} ry={5} fill="#ff6f91" opacity={0.28} />
      {mouth()}
    </g>
  );
}

export { OL, SW };
