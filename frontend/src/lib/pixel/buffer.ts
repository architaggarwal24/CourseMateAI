/**
 * A tiny software rasteriser for pixel-art sprites. Shapes (tapered capsules for limbs, ellipses, polygons) are
 * filled pixel by pixel and SHADED from a fake 3D normal against one light (upper-left, toward the viewer), using a
 * material's 5-step ramp. Where a shape is drawn over another one its edge gets the dark outline colour, which gives
 * the "inner line" between overlapping parts. A final pass outlines the whole silhouette.
 *
 * Pure TypeScript over a Uint32Array: it runs in the browser (into a canvas) and in Node (tests, previews).
 */
import { TRANSPARENT, type Material, type RGBA } from "./color";

export type Pt = [number, number];

export interface DrawOpts {
  /** Draw every pixel at this ramp step (0..4) - no shading. */
  flat?: number;
  /** Add to the light value (-1..1): >0 brighter, <0 darker. */
  bias?: number;
  /** Inner line where this shape overlaps one already drawn (default true). */
  rim?: boolean;
  /** Only paint where something is already drawn (details on top of a body part). */
  clip?: boolean;
  /** Only paint where nothing is drawn yet (parts tucked BEHIND what is there). */
  under?: boolean;
  /** Capsules: shade across the axis only (no darker end caps) - chained tubes look continuous. */
  smooth?: boolean;
}

const L = (() => { const v = [-0.55, -0.72, 0.42]; const n = Math.hypot(...v); return v.map((x) => x / n); })();

export class PixelBuffer {
  readonly w: number;
  readonly h: number;
  readonly px: Uint32Array;
  /** Material index + 1 per pixel (0 = empty or flat colour) - the outline pass reads its colour from it. */
  readonly mat: Uint16Array;
  private mats: Material[] = [];

  constructor(w: number, h: number) {
    this.w = w; this.h = h;
    this.px = new Uint32Array(w * h);
    this.mat = new Uint16Array(w * h);
  }

  private matId(m: Material): number {
    let i = this.mats.indexOf(m);
    if (i < 0) { this.mats.push(m); i = this.mats.length - 1; }
    return i + 1;
  }

  get(x: number, y: number): RGBA {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? TRANSPARENT : this.px[y * this.w + x];
  }

  set(x: number, y: number, c: RGBA, m = 0) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.px[i] = c;
    this.mat[i] = m;
  }

  /** Light value for a fake sphere normal (nx, ny with |n| <= 1). */
  private shade(m: Material, nx: number, ny: number, edge: number, o: DrawOpts, i: number, mi: number): RGBA {
    if (o.flat !== undefined) return m.ramp[o.flat];
    const r2 = Math.min(1, nx * nx + ny * ny);
    const nz = Math.sqrt(1 - r2);
    const v = nx * L[0] + ny * L[1] + nz * L[2] + (o.bias ?? 0);
    if (o.rim !== false && !m.emissive && edge > 0.86 && this.px[i] !== TRANSPARENT && this.mat[i] !== mi) return m.ramp[0];
    if (m.emissive) return v > 0.45 ? m.ramp[4] : v > 0.1 ? m.ramp[3] : m.ramp[2];
    if (m.shiny && v > 0.8) return m.ramp[4];
    if (v > 0.56) return m.ramp[3];
    if (v > 0.12) return m.ramp[2];
    return m.ramp[1];
  }

  private paint(x: number, y: number, m: Material, nx: number, ny: number, edge: number, o: DrawOpts, mi: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (o.clip && this.px[i] === TRANSPARENT) return;
    if (o.under && this.px[i] !== TRANSPARENT) return;
    this.px[i] = this.shade(m, nx, ny, edge, o, i, mi);
    this.mat[i] = mi;
  }

  /** A filled ellipse, optionally rotated (radians). */
  ellipse(cx: number, cy: number, rx: number, ry: number, m: Material, o: DrawOpts = {}, rot = 0) {
    const mi = this.matId(m);
    const ext = Math.max(rx, ry) + 1;
    const c = Math.cos(-rot), s = Math.sin(-rot);
    for (let y = Math.floor(cy - ext); y <= Math.ceil(cy + ext); y++) {
      for (let x = Math.floor(cx - ext); x <= Math.ceil(cx + ext); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const lx = (dx * c - dy * s) / rx, ly = (dx * s + dy * c) / ry;
        const d2 = lx * lx + ly * ly;
        if (d2 > 1) continue;
        // normal back in screen space
        const nx = lx * Math.cos(rot) - ly * Math.sin(rot), ny = lx * Math.sin(rot) + ly * Math.cos(rot);
        this.paint(x, y, m, nx, ny, Math.sqrt(d2), o, mi);
      }
    }
  }

  /** A tapered capsule from a (radius ra) to b (radius rb): arms, legs, necks, tails, horns. */
  capsule(ax: number, ay: number, bx: number, by: number, ra: number, rb: number, m: Material, o: DrawOpts = {}) {
    const mi = this.matId(m);
    const ext = Math.max(ra, rb) + 1;
    const x0 = Math.floor(Math.min(ax, bx) - ext), x1 = Math.ceil(Math.max(ax, bx) + ext);
    const y0 = Math.floor(Math.min(ay, by) - ext), y1 = Math.ceil(Math.max(ay, by) + ext);
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy || 1e-6;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
        const qx = ax + vx * t, qy = ay + vy * t;
        const r = ra + (rb - ra) * t;
        const dx = px - qx, dy = py - qy;
        const d = Math.hypot(dx, dy);
        if (d > r || r <= 0) continue;
        let nx = dx / Math.max(r, 0.5), ny = dy / Math.max(r, 0.5);
        if (o.smooth) {               // keep only the part of the normal across the axis
          const l = Math.sqrt(len2), ux = -vy / l, uy = vx / l;
          const k = nx * ux + ny * uy;
          nx = ux * k; ny = uy * k;
        }
        this.paint(x, y, m, nx, ny, d / r, o, mi);
      }
    }
  }

  /** A filled polygon (even-odd). Shaded as a soft dome over its bounding box. */
  poly(pts: Pt[], m: Material, o: DrawOpts = {}) {
    if (pts.length < 3) return;
    const mi = this.matId(m);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const hx = Math.max(1, (maxX - minX) / 2), hy = Math.max(1, (maxY - minY) / 2);
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const py = y + 0.5;
      const xs: number[] = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py)) xs.push(xi + ((py - yi) / (yj - yi)) * (xj - xi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) {
          const nx = ((x + 0.5 - cx) / hx) * 0.8, ny = ((py - cy) / hy) * 0.8;
          // distance to the outline (for the inner line)
          let dmin = Infinity;
          for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) dmin = Math.min(dmin, segDist(x + 0.5, py, pts[j], pts[i]));
          this.paint(x, y, m, nx, ny, dmin < 1 ? 1 : 0, o, mi);
        }
      }
    }
  }

  /** A 1px line in one flat colour (Bresenham). */
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Outline the silhouette: every empty pixel touching a drawn one takes that pixel's material outline colour. */
  outline(fallback: RGBA, only?: RGBA) {
    const { w, h, px, mat } = this;
    const out = new Uint32Array(px);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (px[i] !== TRANSPARENT) continue;
        let n = -1;
        if (x > 0 && px[i - 1] !== TRANSPARENT) n = i - 1;
        else if (x < w - 1 && px[i + 1] !== TRANSPARENT) n = i + 1;
        else if (y > 0 && px[i - w] !== TRANSPARENT) n = i - w;
        else if (y < h - 1 && px[i + w] !== TRANSPARENT) n = i + w;
        if (n < 0) continue;
        const m = mat[n] ? this.mats[mat[n] - 1] : undefined;
        out[i] = only ?? (m && !m.emissive ? m.ramp[0] : fallback);
      }
    }
    px.set(out);
  }

  /** Every drawn pixel in one colour (hit flash, silhouettes, shadows). */
  silhouette(c: RGBA): PixelBuffer {
    const b = new PixelBuffer(this.w, this.h);
    for (let i = 0; i < this.px.length; i++) if (this.px[i] !== TRANSPARENT) b.px[i] = c;
    return b;
  }

  /** Copy another buffer in (non-transparent pixels), optionally mirrored. */
  blit(src: PixelBuffer, dx: number, dy: number, flip = false) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.px[y * src.w + x];
        if (c === TRANSPARENT) continue;
        this.set(dx + (flip ? src.w - 1 - x : x), dy + y, c, 0);
      }
    }
  }

  /** A copy rotated by `deg` (clockwise, nearest neighbour) around `pivot` - a falling figure. */
  rotated(deg: number, pivot: Pt): PixelBuffer {
    const out = new PixelBuffer(this.w, this.h);
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        // inverse map: where did this output pixel come from?
        const dx = x + 0.5 - pivot[0], dy = y + 0.5 - pivot[1];
        const sx = Math.floor(pivot[0] + dx * c + dy * s), sy = Math.floor(pivot[1] - dx * s + dy * c);
        if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) continue;
        out.px[y * this.w + x] = this.px[sy * this.w + sx];
      }
    }
    return out;
  }

  /** The tight box around what was drawn: [x, y, w, h] (all zero when empty). */
  bounds(): [number, number, number, number] {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.px[y * this.w + x] !== TRANSPARENT) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return x1 < 0 ? [0, 0, 0, 0] : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }
}

function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - a[0] - vx * t, py - a[1] - vy * t);
}
