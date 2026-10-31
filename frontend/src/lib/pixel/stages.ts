/**
 * Fight stages: one painted backdrop per myth, 480x270 pixels - a dithered sky, far and near silhouettes, set
 * pieces, and a floor in perspective. The backdrop is painted once and cached; the scene animates the stage's
 * ambient particles (snow, embers, petals...) and light flicker on top.
 */
import { PixelBuffer, type Pt } from "./buffer";
import { hex, ramp, shift, unpack, pack, type Material, type RGBA } from "./color";

export const STAGE_W = 480;
export const STAGE_H = 270;
export const HORIZON = 168;
/** Where fighters stand. */
export const GROUND_Y = 236;

export type ParticleKind = "snow" | "embers" | "petals" | "fireflies" | "sand" | "wisps" | "rain" | "bubbles" | "feathers" | "dust";

export interface StageDef {
  id: string;
  name: string;
  particles: { kind: ParticleKind; color: string; count: number };
  /** Light sources that flicker (torches, lava): [x, y, radius, colour]. */
  lights: [number, number, number, string][];
  /** Lightning flashes now and then. */
  storm?: boolean;
  paint: (b: PixelBuffer) => void;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  const [ar, ag, ab] = unpack(a), [br, bg, bb] = unpack(b);
  return pack(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t, 255);
}

/** A vertical gradient quantised to `steps` bands with ordered dithering between them (the classic pixel sky). */
function sky(b: PixelBuffer, stops: string[], y0 = 0, y1 = HORIZON + 10, steps = 10) {
  const cols = stops.map((s) => hex(s));
  const at = (u: number) => {
    const f = u * (cols.length - 1), i = Math.min(cols.length - 2, Math.floor(f));
    return mix(cols[i], cols[i + 1], f - i);
  };
  const palette = Array.from({ length: steps }, (_, i) => at(i / (steps - 1)));
  for (let y = y0; y < y1; y++) {
    const u = (y - y0) / Math.max(1, y1 - y0 - 1) * (steps - 1);
    const i = Math.floor(u), frac = u - i;
    for (let x = 0; x < b.w; x++) {
      const th = BAYER[(y & 3) * 4 + (x & 3)] / 16;
      b.set(x, y, palette[Math.min(steps - 1, frac > th ? i + 1 : i)]);
    }
  }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** A ridge line of mountains / dunes / waves: filled down to `bottom`. */
function ridge(b: PixelBuffer, base: number, amp: number, seed: number, color: RGBA, bottom = HORIZON + 20, jag = 0.08) {
  const r = rng(seed);
  const pts: number[] = [];
  let h = 0, v = 0;
  for (let x = 0; x < b.w; x++) {
    v += (r() - 0.5) * jag * amp; v *= 0.96; h += v;
    h = Math.max(-amp, Math.min(amp, h));
    pts.push(base - amp * 0.4 + h);
  }
  for (let x = 0; x < b.w; x++) for (let y = Math.floor(pts[x]); y < bottom; y++) b.set(x, y, color);
}

function peaks(b: PixelBuffer, seed: number, n: number, base: number, hmin: number, hmax: number, color: RGBA, snow?: RGBA) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const cx = r() * b.w, h = hmin + r() * (hmax - hmin), w = h * (0.9 + r() * 0.8);
    for (let y = Math.floor(base - h); y < base; y++) {
      const half = ((y - (base - h)) / h) * w;
      for (let x = Math.floor(cx - half); x <= cx + half; x++) {
        const cap = snow && y < base - h * 0.72 && (x + y) % 7 !== 0;
        b.set(x, y, cap ? snow! : x < cx ? color : shift(color, -0.04, 6));
      }
    }
  }
}

/** The perspective floor: rows get taller toward the viewer, columns converge on the vanishing point. */
function floor(b: PixelBuffer, top: number, a: string, c: string, line: string, cols = 16, style: "tiles" | "planks" | "plain" = "tiles") {
  const A = hex(a), C = hex(c), Ln = hex(line);
  const vx = b.w / 2;
  for (let y = top; y < b.h; y++) {
    const z = (y - top + 6) / (b.h - top + 6);
    const row = Math.floor(Math.log(z * 8 + 1) * 4.2);
    const prevRow = Math.floor(Math.log(((y - 1 - top + 6) / (b.h - top + 6)) * 8 + 1) * 4.2);
    for (let x = 0; x < b.w; x++) {
      const spread = (x - vx) / (0.25 + z * 0.75);
      const col = Math.floor(spread / (b.w / cols) + 100);
      const edge = y !== top && row !== prevRow;
      const colEdge = style !== "planks" && Math.floor(((x + 1 - vx) / (0.25 + z * 0.75)) / (b.w / cols) + 100) !== col;
      const base = style === "planks" ? (row % 2 ? A : C) : style === "plain" ? A : ((row + col) % 2 ? A : C);
      const lit = mix(base, hex("#ffffff"), Math.max(0, 0.12 - z * 0.12));   // far floor catches the sky light
      b.set(x, y, edge || colEdge ? Ln : mix(lit, hex("#000000"), z * 0.18));
    }
  }
  // planks: random seams
  if (style === "planks") {
    const r = rng(7);
    for (let i = 0; i < 70; i++) {
      const y = top + Math.floor(r() * (b.h - top)), x = Math.floor(r() * b.w);
      b.set(x, y, Ln); b.set(x, y + 1, Ln);
    }
  }
}

function column(b: PixelBuffer, x: number, top: number, bottom: number, w: number, m: Material, broken = 0) {
  b.rect(x - w / 2 - 3, bottom - 5, w + 6, 5, m.ramp[1]);
  if (!broken) b.rect(x - w / 2 - 3, top - 4, w + 6, 4, m.ramp[2]);
  for (let y = top + broken; y < bottom - 5; y++) {
    for (let i = 0; i < w; i++) {
      const fl = i % 4 === 0 ? m.ramp[1] : i < w * 0.3 ? m.ramp[3] : i > w * 0.75 ? m.ramp[1] : m.ramp[2];
      b.set(x - w / 2 + i, y, fl);
    }
  }
  if (broken) b.poly([[x - w / 2, top + broken], [x + w / 2, top + broken - 6], [x + w / 2, top + broken + 3]], m, { flat: 2 });
}

function brazier(b: PixelBuffer, x: number, y: number, metal: Material) {
  b.capsule(x, y, x, y - 18, 1.5, 1.5, metal);
  b.poly([[x - 7, y - 22], [x + 7, y - 22], [x + 4, y - 16], [x - 4, y - 16]], metal);
  b.ellipse(x, y - 25, 5, 5, ramp("#f97316", { emissive: true }), { rim: false });
  b.ellipse(x, y - 27, 2.5, 4, ramp("#fde047", { emissive: true }), { rim: false });
}

function moon(b: PixelBuffer, x: number, y: number, r: number, color: string) {
  b.ellipse(x, y, r + 6, r + 6, ramp(color, { emissive: true }), { flat: 1, rim: false });
  b.ellipse(x, y, r, r, ramp(color, { emissive: true }), { flat: 3 });
  b.ellipse(x - r * 0.3, y + r * 0.2, r * 0.25, r * 0.2, ramp(color), { flat: 1, rim: false });
}

function tree(b: PixelBuffer, x: number, base: number, h: number, m: Material, kind: "pine" | "dead" | "sakura", leaf?: Material) {
  if (kind === "pine") {
    b.rect(x - 1, base - 6, 3, 6, m.ramp[0]);
    for (let i = 0; i < 4; i++) {
      const w = (h * 0.35) * (1 - i * 0.2), y = base - 4 - i * h * 0.22;
      b.poly([[x - w, y], [x + w, y], [x, y - h * 0.38]], m, { flat: 1 + (i % 2), rim: false });
    }
  } else {
    b.capsule(x, base, x + 2, base - h * 0.6, 3, 2, m, { flat: 1 });
    b.capsule(x + 2, base - h * 0.6, x - h * 0.3, base - h * 0.9, 2, 1, m, { flat: 1 });
    b.capsule(x + 2, base - h * 0.55, x + h * 0.35, base - h * 0.85, 1.6, 0.8, m, { flat: 1 });
    if (kind === "sakura" && leaf) {
      const r = rng(x | 0);
      for (let i = 0; i < 14; i++) b.ellipse(x - h * 0.4 + r() * h * 0.8, base - h * 0.75 - r() * h * 0.35, 5 + r() * 6, 4 + r() * 4, leaf, { flat: i % 3 === 0 ? 3 : 2, rim: false });
    }
  }
}

// ── the stages ────────────────────────────────────────────────────────────────
const STONE = ramp("#a8a29e"), DARK_STONE = ramp("#57534e"), MARBLE = ramp("#e7e5e4"), IRON = ramp("#3f3f46");

export const STAGES: Record<string, StageDef> = {
  labyrinth: {
    id: "labyrinth", name: "The Labyrinth", particles: { kind: "embers", color: "#fdba74", count: 26 },
    lights: [[70, 175, 40, "#f97316"], [410, 175, 40, "#f97316"]],
    paint: (b) => {
      sky(b, ["#1e1b4b", "#7c2d12", "#ea580c", "#fdba74"]);
      peaks(b, 3, 7, HORIZON - 10, 20, 55, hex("#3b1e3f"));
      ridge(b, HORIZON - 14, 14, 4, hex("#2a1530"));
      // maze walls receding
      for (const [x, w, h] of [[30, 70, 64], [130, 50, 46], [300, 52, 46], [380, 80, 66]] as const) {
        b.rect(x, HORIZON + 6 - h, w, h, DARK_STONE.ramp[1]);
        b.rect(x, HORIZON + 6 - h, w, 3, DARK_STONE.ramp[3]);
        for (let yy = HORIZON + 6 - h + 8; yy < HORIZON + 6; yy += 8) for (let xx = x + ((yy / 8) % 2) * 6; xx < x + w; xx += 12) b.set(xx, yy, DARK_STONE.ramp[0]);
      }
      column(b, 230, 70, HORIZON + 8, 16, MARBLE, 30);
      floor(b, HORIZON + 6, "#78716c", "#6b625b", "#3f3a36", 14);
      brazier(b, 70, 214, IRON); brazier(b, 410, 214, IRON);
    },
  },
  forge: {
    id: "forge", name: "The Thunder Forge", particles: { kind: "embers", color: "#fb923c", count: 40 },
    lights: [[240, 150, 120, "#ef4444"]],
    paint: (b) => {
      sky(b, ["#0c0a09", "#450a0a", "#9a3412", "#f97316"]);
      peaks(b, 9, 3, HORIZON, 50, 110, hex("#1c1917"));
      // lava river glow at the horizon
      for (let x = 0; x < b.w; x++) for (let y = HORIZON - 4; y < HORIZON + 6; y++) b.set(x, y, (x + y * 3) % 11 === 0 ? hex("#fde047") : hex(y < HORIZON ? "#f97316" : "#dc2626"));
      for (const x of [60, 140, 350, 430]) { b.rect(x, HORIZON - 70, 14, 70, IRON.ramp[1]); b.rect(x - 3, HORIZON - 74, 20, 6, IRON.ramp[2]); }
      floor(b, HORIZON + 6, "#292524", "#1c1917", "#ea580c", 12);
      // anvil
      b.poly([[200, 222], [280, 222], [270, 212], [295, 204], [205, 204], [190, 210]], IRON);
    },
  },
  shrine: {
    id: "shrine", name: "Moonlit Shrine", particles: { kind: "petals", color: "#f9a8d4", count: 34 },
    lights: [[120, 200, 30, "#fde68a"], [360, 200, 30, "#fde68a"]],
    paint: (b) => {
      sky(b, ["#020617", "#1e1b4b", "#312e81", "#6d28d9"]);
      moon(b, 360, 54, 26, "#fef9c3");
      peaks(b, 21, 5, HORIZON - 4, 30, 70, hex("#1e1b4b"));
      tree(b, 40, HORIZON + 6, 90, ramp("#1c1917"), "sakura", ramp("#f472b6"));
      tree(b, 450, HORIZON + 6, 80, ramp("#1c1917"), "sakura", ramp("#f9a8d4"));
      // torii gate
      const red = ramp("#dc2626");
      b.rect(196, 64, 8, 106, red.ramp[2]); b.rect(276, 64, 8, 106, red.ramp[2]);
      b.rect(198, 64, 3, 106, red.ramp[3]); b.rect(278, 64, 3, 106, red.ramp[3]);
      b.poly([[176, 66], [304, 66], [312, 58], [168, 58]], ramp("#1c1917"), { flat: 2 });
      b.rect(186, 82, 108, 6, red.ramp[2]);
      floor(b, HORIZON + 6, "#78350f", "#713f12", "#3b1d0a", 10, "planks");
      for (const x of [120, 360]) { b.rect(x - 4, 186, 8, 18, STONE.ramp[1]); b.rect(x - 8, 180, 16, 6, STONE.ramp[2]); b.rect(x - 5, 186, 10, 7, hex("#fde68a")); }
    },
  },
  temple: {
    id: "temple", name: "Jungle Temple", particles: { kind: "fireflies", color: "#bef264", count: 22 },
    lights: [[90, 196, 34, "#fbbf24"], [390, 196, 34, "#fbbf24"]],
    paint: (b) => {
      sky(b, ["#052e16", "#134e4a", "#0f766e", "#fbbf24"]);
      ridge(b, HORIZON - 4, 18, 33, hex("#14532d"));
      // shikhara towers
      const st = ramp("#57534e");
      for (const [x, h, w] of [[240, 130, 70], [150, 90, 44], [330, 90, 44]] as const) {
        for (let i = 0; i < 9; i++) {
          const ww = w * (1 - i / 10), y = HORIZON + 6 - (i + 1) * (h / 9);
          b.rect(x - ww / 2, y, ww, h / 9 + 1, i % 2 ? st.ramp[1] : st.ramp[2]);
        }
        b.ellipse(x, HORIZON + 4 - h, 6, 5, ramp("#facc15", { shiny: true }));
      }
      for (let i = 0; i < 12; i++) { const x = 10 + i * 42; b.capsule(x, 0, x + 4, 30 + (i % 3) * 18, 1.2, 1, ramp("#166534"), { flat: 2 }); }
      floor(b, HORIZON + 6, "#78716c", "#57534e", "#292524", 12);
      brazier(b, 90, 214, ramp("#a16207")); brazier(b, 390, 214, ramp("#a16207"));
    },
  },
  frost: {
    id: "frost", name: "Frozen Wolf-Field", particles: { kind: "snow", color: "#f8fafc", count: 70 },
    lights: [],
    paint: (b) => {
      sky(b, ["#020617", "#0c4a6e", "#155e75", "#334155"]);
      // aurora ribbons
      for (let k = 0; k < 2; k++) for (let x = 0; x < b.w; x++) {
        const y = 40 + k * 20 + Math.sin(x / 40 + k) * 12;
        for (let i = 0; i < 14; i++) if ((x + i) % 3 !== 0) b.set(x, y + i, mix(hex(k ? "#22d3ee" : "#4ade80"), hex("#0c4a6e"), i / 14));
      }
      peaks(b, 5, 6, HORIZON, 40, 95, hex("#334155"), hex("#e2e8f0"));
      for (let i = 0; i < 14; i++) tree(b, 10 + i * 36 + (i % 2) * 8, HORIZON + 8, 34 + (i % 3) * 10, ramp("#0f2b2b"), "pine");
      floor(b, HORIZON + 6, "#cbd5e1", "#b8c6d6", "#94a3b8", 12, "plain");
    },
  },
  desert: {
    id: "desert", name: "Sands of the Riddle", particles: { kind: "sand", color: "#fcd34d", count: 40 },
    lights: [],
    paint: (b) => {
      sky(b, ["#7c2d12", "#ea580c", "#fb923c", "#fde68a"]);
      b.ellipse(120, 120, 30, 30, ramp("#fef3c7", { emissive: true }), { flat: 3 });
      for (const [x, h] of [[300, 80], [380, 56], [220, 40]] as const) {
        b.poly([[x - h, HORIZON + 4], [x, HORIZON + 4 - h], [x + h, HORIZON + 4]], ramp("#b45309"), { flat: 2, rim: false });
        b.poly([[x, HORIZON + 4 - h], [x + h, HORIZON + 4], [x + h * 0.2, HORIZON + 4]], ramp("#92400e"), { flat: 2, rim: false });
      }
      ridge(b, HORIZON + 4, 8, 12, hex("#d97706"));
      for (const x of [40, 440]) { column(b, x, 60, HORIZON + 30, 22, ramp("#d6a75a")); for (let y = 70; y < 180; y += 9) b.rect(x - 4, y, 3, 3, hex("#1e3a8a")); }
      floor(b, HORIZON + 8, "#e9b86b", "#dca45a", "#c48a3e", 10, "plain");
    },
  },
  underworld: {
    id: "underworld", name: "Hall of the Weighing", particles: { kind: "wisps", color: "#4ade80", count: 18 },
    lights: [[60, 170, 40, "#22c55e"], [420, 170, 40, "#22c55e"]],
    paint: (b) => {
      sky(b, ["#020617", "#1e1b4b", "#14532d", "#052e16"]);
      // the great scales
      const gold = ramp("#ca8a04", { shiny: true });
      b.rect(238, 40, 5, 120, gold.ramp[2]);
      b.capsule(170, 60, 310, 60, 2, 2, gold, { flat: 2 });
      for (const x of [170, 310]) { b.line(x, 60, x - 14, 96, gold.ramp[1]); b.line(x, 60, x + 14, 96, gold.ramp[1]); b.ellipse(x, 98, 16, 4, gold, { flat: 2 }); }
      b.ellipse(170, 93, 4, 4, ramp("#dc2626"));          // a heart on one pan
      b.capsule(310, 93, 314, 84, 1, 0.3, ramp("#f8fafc")); // the feather on the other
      for (const x of [30, 100, 380, 450]) column(b, x, 30, HORIZON + 10, 24, ramp("#3f3f46"));
      floor(b, HORIZON + 6, "#1f2937", "#18212f", "#14532d", 14);
      brazier(b, 60, 212, IRON); brazier(b, 420, 212, IRON);
    },
  },
  swamp: {
    id: "swamp", name: "Lernaean Mire", particles: { kind: "fireflies", color: "#d9f99d", count: 26 },
    lights: [],
    paint: (b) => {
      sky(b, ["#0f172a", "#1a2e05", "#365314", "#4d7c0f"]);
      ridge(b, HORIZON - 30, 22, 8, hex("#1a2e05"));
      for (const [x, h] of [[40, 120], [120, 80], [380, 100], [450, 130]] as const) tree(b, x, HORIZON + 8, h, ramp("#1c1917"), "dead");
      column(b, 250, 100, HORIZON + 8, 18, ramp("#6b7280"), 20);
      floor(b, HORIZON + 6, "#3f6212", "#365314", "#1a2e05", 10, "plain");
      // murky pools
      for (const [x, y, w] of [[90, 200, 70], [330, 222, 110], [210, 252, 90]] as const) b.ellipse(x, y, w / 2, 5, ramp("#164e63"), { flat: 2, rim: false });
    },
  },
  sea: {
    id: "sea", name: "World's Edge", particles: { kind: "rain", color: "#93c5fd", count: 80 }, storm: true,
    lights: [],
    paint: (b) => {
      sky(b, ["#020617", "#0f172a", "#1e293b", "#334155"]);
      // storm clouds
      const r = rng(44);
      for (let i = 0; i < 26; i++) b.ellipse(r() * b.w, 20 + r() * 60, 24 + r() * 30, 8 + r() * 10, ramp("#1e293b"), { flat: i % 2 ? 1 : 2, rim: false });
      // sea with wave crests
      for (let y = HORIZON - 30; y < HORIZON + 8; y++) for (let x = 0; x < b.w; x++) {
        const crest = Math.sin(x / 14 + y * 0.9) > 0.92;
        b.set(x, y, crest ? hex("#94a3b8") : hex(y < HORIZON - 12 ? "#0f2a3d" : "#123447"));
      }
      // a wrecked ship
      b.poly([[60, HORIZON - 14], [150, HORIZON - 20], [140, HORIZON - 4], [72, HORIZON]], ramp("#292524"), { flat: 1 });
      b.rect(100, HORIZON - 80, 3, 62, hex("#1c1917"));
      b.poly([[103, HORIZON - 76], [130, HORIZON - 60], [103, HORIZON - 44]], ramp("#57534e"), { flat: 1 });
      floor(b, HORIZON + 6, "#334155", "#1e293b", "#0f172a", 12);
    },
  },
  peaks: {
    id: "peaks", name: "Above the Clouds", particles: { kind: "feathers", color: "#fbcfe8", count: 16 },
    lights: [],
    paint: (b) => {
      sky(b, ["#1e3a8a", "#7c3aed", "#f472b6", "#fde68a"]);
      b.ellipse(240, HORIZON - 6, 40, 40, ramp("#fef3c7", { emissive: true }), { flat: 3 });
      peaks(b, 77, 5, HORIZON + 6, 50, 110, hex("#6d28d9"), hex("#fbcfe8"));
      const r = rng(5);
      for (let i = 0; i < 18; i++) b.ellipse(r() * b.w, HORIZON - 10 + r() * 20, 30 + r() * 30, 7 + r() * 5, ramp("#fce7f3"), { flat: i % 2 ? 3 : 2, rim: false });
      floor(b, HORIZON + 8, "#8b8580", "#a19a94", "#5f5954", 10);
    },
  },
};

export const STAGE_FOR_ORIGIN: Record<string, string> = {
  Greek: "labyrinth", Norse: "frost", Indian: "temple", Japanese: "shrine", Egyptian: "desert", Persian: "peaks",
};

const cache = new Map<string, PixelBuffer>();

/** The painted backdrop for a stage (cached). */
export function stageBackdrop(id: string): PixelBuffer {
  const stage = STAGES[id] ?? STAGES.labyrinth;
  let buf = cache.get(stage.id);
  if (!buf) {
    buf = new PixelBuffer(STAGE_W, STAGE_H);
    stage.paint(buf);
    cache.set(stage.id, buf);
  }
  return buf;
}

export type { Pt };
