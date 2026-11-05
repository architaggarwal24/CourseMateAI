/**
 * Colour for the pixel engine: packed RGBA (little-endian ABGR, the layout ImageData wants) and hue-shifted ramps.
 *
 * A ramp is how pixel artists shade one material: shadows drift toward blue/violet and lose a little lightness,
 * highlights drift toward warm yellow. That shift is most of what makes a sprite look painted instead of "darkened".
 */

export type RGBA = number; // 0xAABBGGRR

export interface Material {
  /** [outline, shadow, mid, light, highlight] */
  ramp: [RGBA, RGBA, RGBA, RGBA, RGBA];
  /** Metal / gems: the highlight step is used on the brightest pixels. */
  shiny?: boolean;
  /** Glow (magic, eyes, fire): drawn flat at mid/light, never shaded dark, no rim. */
  emissive?: boolean;
}

export const TRANSPARENT = 0;

export function pack(r: number, g: number, b: number, a = 255): RGBA {
  return ((a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | (r & 255)) >>> 0;
}

export function unpack(c: RGBA): [number, number, number, number] {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, (c >>> 24) & 255];
}

export function hex(h: string, a = 255): RGBA {
  const s = h.replace("#", "");
  const full = s.length === 3 ? s.split("").map((x) => x + x).join("") : s;
  const n = parseInt(full, 16);
  return pack((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}

export function toCss(c: RGBA): string {
  const [r, g, b, a] = unpack(c);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Move hue `h` toward `target` by `amount` degrees along the shorter way round. */
function hueToward(h: number, target: number, amount: number): number {
  let d = target - h;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return h + Math.sign(d) * Math.min(Math.abs(d), amount);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** One shifted step of a colour: dl = lightness change, hue drifts to cool (dl<0) or warm (dl>0). */
export function shift(base: string | RGBA, dl: number, hueAmount = 14, ds = 0): RGBA {
  const [r, g, b, a] = typeof base === "string" ? unpack(hex(base)) : unpack(base);
  const [h, s, l] = rgbToHsl(r, g, b);
  const nh = s < 0.06 ? h : hueToward(h, dl < 0 ? 245 : 52, hueAmount * Math.min(1, Math.abs(dl) * 3));
  const [nr, ng, nb] = hslToRgb(nh, clamp01(s + ds), clamp01(l + dl));
  return pack(nr, ng, nb, a);
}

/** A full 5-step material ramp from one base colour. */
export function ramp(base: string, opts: { shiny?: boolean; emissive?: boolean; contrast?: number } = {}): Material {
  const k = opts.contrast ?? 1;
  const [r, g, b] = unpack(hex(base));
  const l = rgbToHsl(r, g, b)[2];
  // Very dark bases still need a visible outline below them; very light ones need a real shadow.
  const outlineDl = -Math.min(0.5, Math.max(0.16, l * 0.72)) * k;
  return {
    ramp: [
      shift(base, outlineDl, 26, 0.05),
      shift(base, -0.13 * k, 16, 0.06),
      hex(base),
      shift(base, 0.1 * k, 12, -0.02),
      shift(base, 0.22 * k, 18, -0.08),
    ],
    shiny: opts.shiny,
    emissive: opts.emissive,
  };
}

/** A copy of a material shaded one step darker (limbs on the far side of the body). */
export function farSide(m: Material): Material {
  const [o, s, mid, l] = m.ramp;
  return { ...m, ramp: [o, shift(s, -0.06, 8), s, mid, l] };
}

/** A copy tinted toward a colour (rage glow, gear tints). t in 0..1. */
export function tint(m: Material, toward: string, t: number): Material {
  const [tr, tg, tb] = unpack(hex(toward));
  const mix = (c: RGBA): RGBA => {
    const [r, g, b, a] = unpack(c);
    return pack(r + (tr - r) * t, g + (tg - g) * t, b + (tb - b) * t, a);
  };
  return { ...m, ramp: m.ramp.map(mix) as Material["ramp"] };
}
