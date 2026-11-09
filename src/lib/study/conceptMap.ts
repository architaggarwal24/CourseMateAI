// The concept map (backend routers/concept_maps.py, services/concept_map_service.py): one cached AI pass per
// document, merged for a course, coloured by mastery heat. Drawn as a mind map (components/map/*).
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

/** Make the map of every document in the scope that has none yet (one AI pass each, cached). Answers when done. */
export async function buildConceptMap(scopeId: string): Promise<ConceptMap> {
  const { data } = await api.POST("/concept-map", { body: { session_id: scopeId } });
  return data as unknown as ConceptMap;
}

export const isBuilding = (m: ConceptMap | null) => !!m && m.status === "building";

const HEAT_LABELS: Record<Heat, string> = { new: "Not tried yet", weak: "Weak", learning: "Learning", strong: "Strong" };
export const heatLabel = (h: Heat) => HEAT_LABELS[h];
export const HEATS: Heat[] = ["weak", "learning", "strong", "new"];

// ── Layout helpers ────────────────────────────────────────────────────────────────────────────────────────────
/** Each relation once (either direction), between concepts that exist, in a fixed order. */
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

// ── Links ──────────────────────────────────────────────────────────────────────────────────────────────────
export function neighbours(id: string, relations: MapRelation[]): string[] {
  const out = new Set<string>();
  for (const r of relations) {
    if (r.source === id) out.add(r.target);
    else if (r.target === id) out.add(r.source);
  }
  return [...out];
}

// ── Mind map layout (round 7) ─────────────────────────────────────────────────────────────────────────────────
// The subject in the middle; its main ideas branch out to both sides; every other concept hangs off the main idea
// it is most directly linked to (a breadth-first walk over the relations from all the main ideas at once). Each
// side is a tidy left-to-right tree, so nothing ever overlaps and every label is whole.
export interface MindNode {
  id: string;                 // a concept id, or MIND_ROOT / MIND_MORE
  name: string;
  depth: number;              // 0 = the subject, 1 = a main idea, 2+ = details
  side: 1 | -1;               // right / left of the subject
  parent: string | null;
  branch: number;             // which main idea it belongs to (its colour); -1 for the subject
  x: number; y: number;       // the pill's centre, px
  w: number; h: number;
}
export interface MindMap {
  nodes: MindNode[]; width: number; height: number; tree: Set<string>;
  /** The concept drawn in the middle (the umbrella idea linked to most main ideas), or null: the subject is. */
  rootConcept: string | null;
}
export const MIND_ROOT = "__subject";
export const MIND_MORE = "__more";
const MAX_HUBS = 8;
const MAX_LABEL = 34;
const ROW = 46, H_GAP = 56, MARGIN = 28, CAPTION = 26;
const FONT: Record<number, number> = { 0: 17, 1: 15, 2: 14 };

export const mindLabel = (name: string) => (name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1).trimEnd()}…` : name);
/** About how wide a pill is: text at the depth's size, the heat dot and padding. */
function pillWidth(name: string, depth: number): number {
  const size = FONT[Math.min(depth, 2)];
  return Math.round(mindLabel(name).length * size * 0.56 + (depth === 0 ? 40 : 46));
}

export function layoutMindMap(subject: string, concepts: MapConcept[], relations: MapRelation[]): MindMap {
  const order = new Map(concepts.map((c, i) => [c.id, i]));
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const adj = new Map<string, string[]>(concepts.map((c) => [c.id, []]));
  for (const [a, b] of pairs(relations, new Set(byId.keys()))) { adj.get(a)!.push(b); adj.get(b)!.push(a); }
  for (const list of adj.values()) list.sort((p, q) => order.get(p)! - order.get(q)!);
  const degree = (id: string) => adj.get(id)!.length;
  const rank = (a: MapConcept, b: MapConcept) => (b.importance - a.importance) || (degree(b.id) - degree(a.id)) || (order.get(a.id)! - order.get(b.id)!);

  // main ideas: the central concepts (most linked first), then one for every group of linked concepts without one
  let hubs = concepts.filter((c) => c.importance >= 3).sort(rank).slice(0, MAX_HUBS + 1).map((c) => c.id);
  // an umbrella idea linked to most of the others ("Unsupervised learning" over clustering, PCA, ...) goes in the
  // middle instead of beside them: the map reads out from it
  const umbrella = hubs.length >= 3 ? hubs.find((h) => {
    const near = hubs.filter((o) => o !== h && adj.get(h)!.includes(o)).length;
    return near >= 2 && near >= (hubs.length - 1) / 2;
  }) ?? null : null;
  if (umbrella) {
    hubs = hubs.filter((h) => h !== umbrella);
    adj.delete(umbrella);
    for (const [k, list] of adj) adj.set(k, list.filter((n) => n !== umbrella));
  }
  hubs = hubs.slice(0, MAX_HUBS);
  const reach = (from: string[]) => {
    const seen = new Set(from);
    const queue = [...from];
    while (queue.length) for (const n of adj.get(queue.shift()!)!) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    return seen;
  };
  let covered = reach(hubs);
  const loners: string[] = [];
  const rest = concepts.filter((c) => c.id !== umbrella);
  for (const c of [...rest].sort(rank)) {
    if (covered.has(c.id)) continue;
    if (!degree(c.id)) { loners.push(c.id); continue; }
    hubs.push(c.id);
    covered = reach(hubs);
  }
  if (!hubs.length && loners.length) hubs.push(loners.shift()!);
  const useMore = loners.length > 2;
  if (!useMore) hubs.push(...loners.splice(0));

  // every concept hangs off the main idea it is nearest to (ties: the more central main idea)
  const parent = new Map<string, string>();
  const branchOf = new Map<string, number>();
  hubs.forEach((h, i) => { parent.set(h, MIND_ROOT); branchOf.set(h, i); });
  const queue = [...hubs];
  while (queue.length) {
    const at = queue.shift()!;
    for (const n of adj.get(at)!) {
      if (branchOf.has(n)) continue;
      parent.set(n, at); branchOf.set(n, branchOf.get(at)!); queue.push(n);
    }
  }
  if (useMore) {
    parent.set(MIND_MORE, MIND_ROOT); branchOf.set(MIND_MORE, hubs.length);
    for (const l of loners) { parent.set(l, MIND_MORE); branchOf.set(l, hubs.length); }
  }
  const children = new Map<string, string[]>();
  for (const [c, p] of parent) children.set(p, [...(children.get(p) ?? []), c]);
  const weight = (id: string) => (id === MIND_MORE ? -1 : byId.get(id)!.importance);
  const pos = (id: string) => (id === MIND_MORE ? Infinity : order.get(id)!);
  for (const list of children.values()) list.sort((a, b) => (weight(b) - weight(a)) || (pos(a) - pos(b)));

  // two sides with about as many rows each (the biggest branches placed first), each kept in reading order
  const leaves = (id: string): number => (children.get(id) ?? []).reduce((s, c) => s + leaves(c), 0) || 1;
  const top = children.get(MIND_ROOT) ?? [];
  const rows = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
  const sideOf = new Map<string, 1 | -1>();
  for (const b of [...top].sort((a, c) => leaves(c) - leaves(a) || top.indexOf(a) - top.indexOf(c))) {
    const s: 1 | -1 = rows[1] <= rows[-1] ? 1 : -1;
    sideOf.set(b, s); rows[s] += leaves(b);
  }

  const nodes = new Map<string, MindNode>();
  const centre = umbrella ? byId.get(umbrella)!.name : subject;
  const name = (id: string) => (id === MIND_ROOT ? centre : id === MIND_MORE ? "More ideas" : byId.get(id)!.name);
  const rootW = pillWidth(centre, 0);
  nodes.set(MIND_ROOT, { id: MIND_ROOT, name: centre, depth: 0, side: 1, parent: null, branch: -1, x: 0, y: 0, w: rootW, h: 44 });
  for (const side of [1, -1] as const) {
    const mine = top.filter((b) => sideOf.get(b) === side);
    // the widest pill at each depth sets that column's width
    const colW: number[] = [];
    const walk = (id: string, depth: number) => {
      colW[depth] = Math.max(colW[depth] ?? 0, pillWidth(name(id), depth));
      for (const c of children.get(id) ?? []) walk(c, depth + 1);
    };
    for (const b of mine) walk(b, 1);
    const colX: number[] = [0, rootW / 2 + H_GAP];
    for (let d = 2; d < colW.length; d++) colX[d] = colX[d - 1] + colW[d - 1] + H_GAP;
    let row = 0;
    const place = (id: string, depth: number, p: string): number => {
      const kids = children.get(id) ?? [];
      const ys = kids.map((k) => place(k, depth + 1, id));
      const y = ys.length ? (ys[0] + ys[ys.length - 1]) / 2 : (row++) * ROW;
      const w = pillWidth(name(id), depth);
      const edge = colX[depth];
      nodes.set(id, { id, name: name(id), depth, side, parent: p, branch: branchOf.get(id)!, x: side * (edge + w / 2), y, w, h: depth === 1 ? 38 : 32 });
      return y;
    };
    for (const b of mine) place(b, 1, MIND_ROOT);
    // centre this side on the subject
    const shift = ((row - 1) * ROW) / 2;
    for (const n of nodes.values()) if (n.side === side && n.depth > 0) n.y -= shift;
  }

  const all = [...nodes.values()];
  const minX = Math.min(...all.map((n) => n.x - n.w / 2)), maxX = Math.max(...all.map((n) => n.x + n.w / 2));
  // (with an umbrella idea in the middle, the subject's name sits just above it: room for that line)
  const upper = (n: MindNode) => n.y - n.h / 2 - (umbrella && n.id === MIND_ROOT ? CAPTION : 0);
  const minY = Math.min(...all.map(upper)), maxY = Math.max(...all.map((n) => n.y + n.h / 2));
  for (const n of all) { n.x = Math.round(n.x - minX + MARGIN); n.y = Math.round(n.y - minY + MARGIN); }
  const tree = new Set(all.filter((n) => n.parent).map((n) => [n.id, n.parent!].sort().join("|")));
  if (umbrella) for (const n of all) if (n.parent === MIND_ROOT) tree.add([n.id, umbrella].sort().join("|"));
  return { nodes: all, width: Math.round(maxX - minX + MARGIN * 2), height: Math.round(maxY - minY + MARGIN * 2), tree, rootConcept: umbrella };
}
