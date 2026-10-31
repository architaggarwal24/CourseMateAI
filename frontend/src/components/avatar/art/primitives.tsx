"use client";
// Shared drawing helpers for the hero art: one outline colour and weight, one soft shading pass, and path helpers.
// Every piece of the hero (body, outfit, hat, weapon, pet) is drawn with these, which is what keeps it one style.
import { createContext, useContext, type ReactNode, type SVGProps } from "react";

export const OL = "#1c1530";          // the outline colour of everything
export const SW = 3.5;                 // the outline weight of everything

const GradientId = createContext("hf");

/** Defines the soft light-to-shadow overlay every filled shape uses. Render once per <svg>. */
export function ArtRoot({ id, children }: { id: string; children: ReactNode }) {
  return (
    <GradientId.Provider value={id}>
      <defs>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.30" />
          <stop offset="0.42" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#0b0618" stopOpacity="0.30" />
        </linearGradient>
      </defs>
      {children}
    </GradientId.Provider>
  );
}

interface ShapeProps extends Omit<SVGProps<SVGPathElement>, "d" | "fill"> {
  d: string;
  fill: string;
  /** outline weight; 0 = none */
  sw?: number;
  /** false = flat colour with no light/shadow overlay */
  shade?: boolean;
}

/** A filled, outlined path with the shared light-and-shadow overlay. */
export function P({ d, fill, sw = SW, shade = true, ...rest }: ShapeProps) {
  const id = useContext(GradientId);
  return (
    <>
      <path d={d} fill={fill} stroke={sw ? OL : "none"} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" {...rest} />
      {shade && <path d={d} fill={`url(#${id}-shade)`} stroke="none" pointerEvents="none" />}
    </>
  );
}

/** An outline-only stroke (hair strands, creases, strings). */
export function L({ d, color = OL, w = 2.5, ...rest }: { d: string; color?: string; w?: number } & Omit<SVGProps<SVGPathElement>, "d">) {
  return <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" {...rest} />;
}

export const ell = (cx: number, cy: number, rx: number, ry: number) =>
  `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;

export const circ = (cx: number, cy: number, r: number) => ell(cx, cy, r, r);

/** Rounded rectangle path. */
export function rr(x: number, y: number, w: number, h: number, r: number) {
  const k = Math.min(r, w / 2, h / 2);
  return `M ${x + k} ${y} H ${x + w - k} Q ${x + w} ${y} ${x + w} ${y + k} V ${y + h - k} Q ${x + w} ${y + h} ${x + w - k} ${y + h} H ${x + k} Q ${x} ${y + h} ${x} ${y + h - k} V ${y + k} Q ${x} ${y} ${x + k} ${y} Z`;
}

/** Mixes a hex colour toward black (amount < 0) or white (amount > 0). */
export function tone(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const f = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
