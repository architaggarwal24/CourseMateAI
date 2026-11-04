// The concept map (backend routers/concept_maps.py, services/concept_map_service.py): one cached AI pass per
// document, merged for a course, coloured by mastery heat. Drawn as a calm star chart (components/map/*).
import { api } from "@/lib/api/client";

export type Heat = "new" | "weak" | "learning" | "strong";
export interface MapConcept {
  id: string; name: string; summary: string; importance: number;
  pages: { doc_id: string; page: number }[]; docs: string[];
  heat: Heat; seen: number; correct: number;
}
export interface MapRelation { source: string; target: string; label: string }
export interface MapDocument { id: string; name: string; status: string; stage?: string | null; error?: string | null }
export type MapStatus = "none" | "building" | "ready" | "partial" | "failed" | "not_ready";
export interface ConceptMap {
  scope: { id: string; kind: "document" | "course"; name: string };
  status: MapStatus; stage?: string | null; built: number; total: number;
  documents: MapDocument[]; concepts: MapConcept[]; relations: MapRelation[];
}

/** What the map is now. Never starts any work. */
export async function fetchConceptMap(scopeId: string): Promise<ConceptMap> {
  const { data } = await api.GET("/concept-map", { params: { query: { session_id: scopeId } } });
  return data as unknown as ConceptMap;
}

/** Start the map of every document in the scope that has none yet (one AI pass each, cached). Returns at once. */
export async function buildConceptMap(scopeId: string): Promise<ConceptMap> {
  const { data } = await api.POST("/concept-map", { body: { session_id: scopeId } });
  return data as unknown as ConceptMap;
}

export const isBuilding = (m: ConceptMap | null) => !!m && m.status === "building";

const HEAT_LABELS: Record<Heat, string> = { new: "Not tried yet", weak: "Weak", learning: "Learning", strong: "Strong" };
export const heatLabel = (h: Heat) => HEAT_LABELS[h];
export const HEATS: Heat[] = ["weak", "learning", "strong", "new"];

// ── Layout ────────────────────────────────────────────────────────────────────────────────────────────────────
export type Point = { x: number; y: number };
const X_MIN = 0.06, X_MAX = 0.94, Y_MIN = 0.08, Y_MAX = 0.92;
const RINGS = [0.13, 0.27, 0.4];
const MIN_GAP = 0.11;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}
function pairs(relations: MapRelation[], ids: Set<string>): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const r of relations) {
    if (!ids.has(r.source) || !ids.has(r.target) || r.source === r.target) continue;
    const [a, b] = r.source < r.target ? [r.source, r.target] : [r.target, r.source];
    if (seen.has(`${a}|${b}`)) continue;
    seen.add(`${a}|${b}`);
    out.push([a, b]);
  }
  return out.sort((p, q) => (p[0] + p[1] < q[0] + q[1] ? -1 : 1));
}

/**
 * Where each star sits, in a unit square (0..1). Deterministic - the same map always draws the same sky, whatever
 * order the server lists it in: central concepts on the inner ring, supporting ones further out, each placed near
 * the stars it is linked to, then a fixed number of relaxation steps keep linked stars close and every star apart.
 */
export function layoutConstellation(concepts: MapConcept[], relations: MapRelation[]): Record<string, Point> {
  const list = [...concepts].sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!list.length) return {};
  if (list.length === 1) return { [list[0].id]: { x: 0.5, y: 0.5 } };
  const ids = new Set(list.map((c) => c.id));
  const links = pairs(relations, ids);
  const degree = new Map<string, number>();
  for (const [a, b] of links) { degree.set(a, (degree.get(a) ?? 0) + 1); degree.set(b, (degree.get(b) ?? 0) + 1); }
  const ranked = [...list].sort((a, b) => b.importance - a.importance || (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1));

  // Rings: how many stars each holds, a slot every MIN_GAP or so around it.
  const capacity = RINGS.map((r) => Math.max(3, Math.floor((2 * Math.PI * r) / (MIN_GAP * 1.15))));
  const used = RINGS.map(() => [] as number[]);                  // slot indices taken
  const ringOf = new Map<string, number>();
  const pos: Record<string, Point> = {};
  const angle = (p: Point) => Math.atan2(p.y - 0.5, p.x - 0.5);

  for (const c of ranked) {
    const want = clamp(3 - Math.round(c.importance), 0, RINGS.length - 1);
    const order = [want, ...RINGS.map((_, i) => i).filter((i) => i !== want).sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || b - a)];
    const ring = order.find((i) => used[i].length < capacity[i]) ?? RINGS.length - 1;
    const n = capacity[ring];
    const offset = hash(`ring${ring}`) * 2 * Math.PI;
    const placed = links.flatMap(([a, b]) => (a === c.id ? [b] : b === c.id ? [a] : [])).filter((o) => pos[o]);
    let prefer = offset;
    if (placed.length) {
      const sx = placed.reduce((s, o) => s + Math.cos(angle(pos[o])), 0), sy = placed.reduce((s, o) => s + Math.sin(angle(pos[o])), 0);
      if (Math.hypot(sx, sy) > 1e-6) prefer = Math.atan2(sy, sx);
    } else {
      prefer = offset + used[ring].length * ((2 * Math.PI) / n) * Math.floor(n / 2 + 1);   // spread the unlinked ones
    }
    let best = -1, bestD = Infinity;
    for (let s = 0; s < n; s++) {
      if (used[ring].includes(s)) continue;
      const a = offset + (s * 2 * Math.PI) / n;
      const d = Math.abs(Math.atan2(Math.sin(a - prefer), Math.cos(a - prefer)));
      if (d < bestD - 1e-9) { bestD = d; best = s; }
    }
    used[ring].push(best);
    ringOf.set(c.id, ring);
    const a = offset + (best * 2 * Math.PI) / n;
    pos[c.id] = { x: 0.5 + RINGS[ring] * Math.cos(a), y: 0.5 + RINGS[ring] * Math.sin(a) };
  }

  // Relax: springs along links, repulsion between all stars, a pull back to each star's ring.
  const keys = list.map((c) => c.id);
  for (let step = 0; step < 80; step++) {
    const force: Record<string, Point> = Object.fromEntries(keys.map((k) => [k, { x: 0, y: 0 }]));
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const p = pos[keys[i]], q = pos[keys[j]];
      const dx = p.x - q.x, dy = p.y - q.y, d = Math.max(0.02, Math.hypot(dx, dy));
      const f = 0.0009 / (d * d);
      force[keys[i]].x += (dx / d) * f; force[keys[i]].y += (dy / d) * f;
      force[keys[j]].x -= (dx / d) * f; force[keys[j]].y -= (dy / d) * f;
    }
    for (const [a, b] of links) {
      const p = pos[a], q = pos[b];
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.max(1e-6, Math.hypot(dx, dy));
      const f = 0.04 * (d - 0.2);
      force[a].x += (dx / d) * f; force[a].y += (dy / d) * f;
      force[b].x -= (dx / d) * f; force[b].y -= (dy / d) * f;
    }
    for (const k of keys) {
      const p = pos[k], r = Math.max(1e-6, Math.hypot(p.x - 0.5, p.y - 0.5));
      const f = 0.12 * (RINGS[ringOf.get(k)!] - r);
      force[k].x += ((p.x - 0.5) / r) * f; force[k].y += ((p.y - 0.5) / r) * f;
      const cap = 0.02;
      p.x = clamp(p.x + clamp(force[k].x, -cap, cap), X_MIN, X_MAX);
      p.y = clamp(p.y + clamp(force[k].y, -cap, cap), Y_MIN, Y_MAX);
    }
  }
  // Last: no two stars closer than the gap (their labels need the room).
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const p = pos[keys[i]], q = pos[keys[j]];
      let dx = p.x - q.x, dy = p.y - q.y;
      let d = Math.hypot(dx, dy);
      if (d >= MIN_GAP * 0.92) continue;
      if (d < 1e-6) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
      const push = (MIN_GAP * 0.92 - Math.min(d, MIN_GAP)) / 2 + 0.002;
      p.x = clamp(p.x + (dx / d) * push, X_MIN, X_MAX); p.y = clamp(p.y + (dy / d) * push, Y_MIN, Y_MAX);
      q.x = clamp(q.x - (dx / d) * push, X_MIN, X_MAX); q.y = clamp(q.y - (dy / d) * push, Y_MIN, Y_MAX);
      moved = true;
    }
    if (!moved) break;
  }
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return Object.fromEntries(keys.map((k) => [k, { x: round(pos[k].x), y: round(pos[k].y) }]));
}

// ── Keyboard ──────────────────────────────────────────────────────────────────────────────────────────────────
export function neighbours(id: string, relations: MapRelation[]): string[] {
  const out = new Set<string>();
  for (const r of relations) {
    if (r.source === id) out.add(r.target);
    else if (r.target === id) out.add(r.source);
  }
  return [...out];
}

const DIRS: Record<string, Point> = { ArrowRight: { x: 1, y: 0 }, ArrowLeft: { x: -1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

/** The star an arrow key moves to: the nearest LINKED star that way, else the nearest star that way, else stay. */
export function starInDirection(from: string, key: string, at: Record<string, Point>, relations: MapRelation[]): string {
  const dir = DIRS[key], p = at[from];
  if (!dir || !p) return from;
  const score = (id: string) => {
    const q = at[id];
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (!d) return Infinity;
    const cos = (dx * dir.x + dy * dir.y) / d;
    return cos < 0.5 ? Infinity : d / (cos * cos);
  };
  const best = (ids: string[]) => ids.map((id) => [id, score(id)] as const).filter(([, s]) => s < Infinity).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  return best(neighbours(from, relations).filter((id) => at[id])) ?? best(Object.keys(at).filter((id) => id !== from)) ?? from;
}
