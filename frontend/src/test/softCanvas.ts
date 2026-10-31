// A tiny software 2D canvas for tests: jsdom has no canvas, and "the pixels are identical" is the thing the avatar
// tests need to prove. It implements exactly the subset the avatar renderer uses (axis-aligned fillRect with
// scale/translate, globalAlpha, save/restore, an ellipse path for fill/stroke/clip, a linear gradient, drawImage
// scaling) over an RGBA buffer, deterministically. Install it with installSoftCanvas(); read a canvas back with
// pixelsOf(canvas) / hashOf(canvas).
import { createHash } from "node:crypto";

type RGBA = [number, number, number, number];            // 0-255 each, alpha 0-1 last
interface Gradient { y0: number; y1: number; stops: { at: number; color: RGBA }[] }
interface Ellipse { cx: number; cy: number; rx: number; ry: number }
interface State {
  fillStyle: string | Gradient; strokeStyle: string; lineWidth: number; globalAlpha: number;
  sx: number; sy: number; tx: number; ty: number; clip: Ellipse | null;
}

const buffers = new WeakMap<HTMLCanvasElement, { w: number; h: number; data: Uint8ClampedArray }>();

export function parseColor(input: string): RGBA {
  const s = input.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) { const [r, g, b] = [...m[1]].map((c) => parseInt(c + c, 16)); return [r, g, b, 1]; }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  throw new Error(`softCanvas: unsupported colour ${input}`);
}

function valid(color: string) { try { parseColor(color); return true; } catch { return false; } }

function bufferOf(canvas: HTMLCanvasElement) {
  const w = canvas.width, h = canvas.height;
  let b = buffers.get(canvas);
  if (!b || b.w !== w || b.h !== h) { b = { w, h, data: new Uint8ClampedArray(w * h * 4) }; buffers.set(canvas, b); }
  return b;
}

class SoftContext {
  imageSmoothingEnabled = true;
  font = ""; textAlign = ""; textBaseline = "";
  private st: State = { fillStyle: "#000000", strokeStyle: "#000000", lineWidth: 1, globalAlpha: 1, sx: 1, sy: 1, tx: 0, ty: 0, clip: null };
  private stack: State[] = [];
  private path: Ellipse | null = null;
  constructor(private canvas: HTMLCanvasElement) {}

  get fillStyle() { return this.st.fillStyle; }
  // Like a browser: a colour string it can't parse is ignored and the previous style stays.
  set fillStyle(v) { if (typeof v !== "string" || valid(v)) this.st.fillStyle = v; }
  get strokeStyle() { return this.st.strokeStyle; }
  set strokeStyle(v: string) { if (valid(v)) this.st.strokeStyle = v; }
  get lineWidth() { return this.st.lineWidth; }
  set lineWidth(v: number) { this.st.lineWidth = v; }
  get globalAlpha() { return this.st.globalAlpha; }
  set globalAlpha(v: number) { this.st.globalAlpha = v; }

  save() { this.stack.push({ ...this.st }); }
  restore() { const s = this.stack.pop(); if (s) this.st = s; }
  scale(x: number, y: number) { this.st.sx *= x; this.st.sy *= y; this.st.tx *= 1; }
  translate(x: number, y: number) { this.st.tx += x * this.st.sx; this.st.ty += y * this.st.sy; }
  fillText() { /* text is not rasterised; the call is allowed so a placeholder glyph doesn't throw */ }

  createLinearGradient(_x0: number, y0: number, _x1: number, y1: number): Gradient & { addColorStop(at: number, color: string): void } {
    const g: Gradient = { y0, y1, stops: [] };
    return Object.assign(g, { addColorStop: (at: number, color: string) => { g.stops.push({ at, color: parseColor(color) }); g.stops.sort((a, b) => a.at - b.at); } });
  }

  beginPath() { this.path = null; }
  arc(cx: number, cy: number, r: number) { this.ellipse(cx, cy, r, r); }
  ellipse(cx: number, cy: number, rx: number, ry: number) {
    const { sx, sy, tx, ty } = this.st;
    this.path = { cx: cx * sx + tx, cy: cy * sy + ty, rx: rx * sx, ry: ry * sy };
  }
  clip() { if (this.path) this.st.clip = this.path; }
  fill() { const e = this.path; if (e) this.paint((x, y) => inside(e, x, y)); }
  stroke() {
    const e = this.path; if (!e) return;
    const half = this.st.lineWidth / 2;
    const outer = { ...e, rx: e.rx + half, ry: e.ry + half }, inner = { ...e, rx: e.rx - half, ry: e.ry - half };
    this.paint((x, y) => inside(outer, x, y) && !inside(inner, x, y), this.st.strokeStyle);
  }

  clearRect(x: number, y: number, w: number, h: number) {
    const b = bufferOf(this.canvas);
    this.each(x, y, w, h, (px, py) => { const i = (py * b.w + px) * 4; b.data[i] = b.data[i + 1] = b.data[i + 2] = b.data[i + 3] = 0; }, false);
  }

  fillRect(x: number, y: number, w: number, h: number) { this.paint(null, undefined, [x, y, w, h]); }

  drawImage(src: HTMLCanvasElement, dx: number, dy: number, dw: number, dh: number) {
    const s = bufferOf(src), d = bufferOf(this.canvas);
    const { sx, sy, tx, ty } = this.st;
    const X0 = Math.round(dx * sx + tx), Y0 = Math.round(dy * sy + ty), X1 = Math.round((dx + dw) * sx + tx), Y1 = Math.round((dy + dh) * sy + ty);
    for (let py = Math.max(0, Y0); py < Math.min(d.h, Y1); py++) for (let px = Math.max(0, X0); px < Math.min(d.w, X1); px++) {
      if (this.st.clip && !inside(this.st.clip, px, py)) continue;
      const u = Math.min(s.w - 1, Math.floor(((px - X0) / (X1 - X0)) * s.w)), v = Math.min(s.h - 1, Math.floor(((py - Y0) / (Y1 - Y0)) * s.h));
      const i = (v * s.w + u) * 4;
      this.blend(d, px, py, [s.data[i], s.data[i + 1], s.data[i + 2], (s.data[i + 3] / 255)]);
    }
  }

  // ── internals ──
  private each(x: number, y: number, w: number, h: number, fn: (px: number, py: number) => void, clip = true) {
    const b = bufferOf(this.canvas);
    const { sx, sy, tx, ty } = this.st;
    const X0 = Math.round(x * sx + tx), Y0 = Math.round(y * sy + ty), X1 = Math.round((x + w) * sx + tx), Y1 = Math.round((y + h) * sy + ty);
    for (let py = Math.max(0, Y0); py < Math.min(b.h, Y1); py++) for (let px = Math.max(0, X0); px < Math.min(b.w, X1); px++) {
      if (clip && this.st.clip && !inside(this.st.clip, px, py)) continue;
      fn(px, py);
    }
  }
  private paint(test: ((x: number, y: number) => boolean) | null, style?: string, rect?: [number, number, number, number]) {
    const b = bufferOf(this.canvas);
    const fs = style ?? this.st.fillStyle;
    const solid = typeof fs === "string" ? parseColor(fs) : null;
    const at = (px: number, py: number): RGBA => (solid ?? gradientAt(fs as Gradient, py));
    if (rect) this.each(rect[0], rect[1], rect[2], rect[3], (px, py) => this.blend(b, px, py, at(px, py)));
    else for (let py = 0; py < b.h; py++) for (let px = 0; px < b.w; px++) {
      if (this.st.clip && !inside(this.st.clip, px, py)) continue;
      if (test!(px, py)) this.blend(b, px, py, at(px, py));
    }
  }
  private blend(b: { w: number; data: Uint8ClampedArray }, px: number, py: number, c: RGBA) {
    const a = c[3] * this.st.globalAlpha;
    if (a <= 0) return;
    const i = (py * b.w + px) * 4;
    const da = b.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    for (let k = 0; k < 3; k++) b.data[i + k] = Math.round((c[k] * a + b.data[i + k] * da * (1 - a)) / (oa || 1));
    b.data[i + 3] = Math.round(oa * 255);
  }
}

// A pixel is inside when its centre is.
function inside(e: Ellipse, px: number, py: number) {
  if (e.rx <= 0 || e.ry <= 0) return false;
  const dx = (px + 0.5 - e.cx) / e.rx, dy = (py + 0.5 - e.cy) / e.ry;
  return dx * dx + dy * dy <= 1;
}
function gradientAt(g: Gradient, py: number): RGBA {
  const t = Math.min(1, Math.max(0, (py + 0.5 - g.y0) / (g.y1 - g.y0 || 1)));
  const s = g.stops;
  if (t <= s[0].at) return s[0].color;
  for (let i = 1; i < s.length; i++) if (t <= s[i].at) {
    const k = (t - s[i - 1].at) / (s[i].at - s[i - 1].at || 1), a = s[i - 1].color, c = s[i].color;
    return [0, 1, 2, 3].map((j) => a[j] + (c[j] - a[j]) * k) as RGBA;
  }
  return s[s.length - 1].color;
}

/** Make every <canvas> in jsdom hand out a SoftContext. Returns a function that puts jsdom back. */
export function installSoftCanvas(): () => void {
  const original = HTMLCanvasElement.prototype.getContext;
  const contexts = new WeakMap<HTMLCanvasElement, SoftContext>();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== "2d") return null;
    let c = contexts.get(this);
    if (!c) { c = new SoftContext(this); contexts.set(this, c); }
    return c as unknown as CanvasRenderingContext2D;
  } as typeof original;
  return () => { HTMLCanvasElement.prototype.getContext = original; };
}

export function pixelsOf(canvas: HTMLCanvasElement) { return bufferOf(canvas); }

/** sha1 of the canvas's size and every RGBA byte, plus how many pixels are not fully transparent (to read a diff). */
export function fingerprint(canvas: HTMLCanvasElement): string {
  const b = bufferOf(canvas);
  let opaque = 0;
  for (let i = 3; i < b.data.length; i += 4) if (b.data[i] > 0) opaque++;
  return `${b.w}x${b.h} ${opaque}px ${createHash("sha1").update(b.data).digest("hex").slice(0, 16)}`;
}
