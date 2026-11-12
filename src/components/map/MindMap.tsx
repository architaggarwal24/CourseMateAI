"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Plus } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import {
  heatLabel, layoutMindMap, MIND_MORE, MIND_ROOT, mindLabel, neighbours, type MapConcept, type MapRelation, type MindNode,
} from "@/lib/study/concept-map";

const BRANCHES = 8;                       // branch colours (map.css --mm-0 .. --mm-7)
const ZOOMS = [0.5, 0.65, 0.8, 1, 1.2, 1.45];

/** A curve from the side of one pill to the side of the next, leaving and arriving level. */
function link(a: MindNode, b: MindNode): string {
  const s = b.side;
  const x1 = a.x + (s * a.w) / 2, y1 = a.y, x2 = b.x - (s * b.w) / 2, y2 = b.y;
  const k = (x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + k},${y1} ${x2 - k},${y2} ${x2},${y2}`;
}
/** A cross-link (a relation that isn't a branch): a soft arc between the two pills. */
function arc(a: MindNode, b: MindNode): string {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const bend = Math.min(80, Math.hypot(b.x - a.x, b.y - a.y) * 0.25);
  return `M${a.x},${a.y} Q${mx},${my - bend} ${b.x},${b.y}`;
}

/**
 * The concept map as a mind map: the course or PDF in the middle, its main ideas branching to both sides, details
 * hanging off them (lib/study/concept-map.ts layoutMindMap). Each branch has its colour; a dot in each pill says how
 * well you know it. Hover or focus a concept to see everything it's linked to. Zoom with the buttons, drag to pan.
 * Keyboard: Tab reaches the map (one stop); Right / Left go out to a detail or back towards the middle, Up / Down
 * move between neighbours in the column, Home goes to the most central concept, Enter / Space opens it, Esc closes.
 */
export default function MindMap({ subject, concepts, relations, selected, onSelect }: {
  subject: string; concepts: MapConcept[]; relations: MapRelation[]; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const map = useMemo(() => layoutMindMap(subject, concepts, relations), [subject, concepts, relations]);
  const byId = useMemo(() => new Map(concepts.map((c) => [c.id, c])), [concepts]);
  const at = useMemo(() => new Map(map.nodes.map((n) => [n.id, n])), [map]);
  /** A concept's pill (the umbrella concept is the one in the middle). */
  const nodeOf = useCallback((id: string) => at.get(id === map.rootConcept ? MIND_ROOT : id), [at, map.rootConcept]);
  /** The concept a pill stands for (the middle one only when it is the umbrella concept). */
  const conceptAt = useCallback((n: MindNode) => (n.id === MIND_ROOT ? map.rootConcept : byId.has(n.id) ? n.id : null), [map.rootConcept, byId]);
  const first = concepts[0]?.id ?? null;                 // the server lists the most central first
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(selected ?? first);
  const pills = useRef(new Map<string, SVGGElement>());
  const current = active && byId.has(active) ? active : first;
  const lit = hovered ?? focused ?? selected;
  const litLinks = useMemo(() => new Set(lit ? neighbours(lit, relations) : []), [lit, relations]);

  // ── zoom & pan ──
  const box = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);         // null: fit the width (down to 80%)
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setFit(Math.max(el.clientWidth < 640 ? 0.55 : 0.8, Math.min(1, (el.clientWidth - 2) / map.width)));   // never too small to read: wider maps scroll
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [map.width]);
  const scale = zoom ?? fit;
  // open on the middle of the map (the widest maps scroll both ways)
  useEffect(() => {
    const el = box.current, r = at.get(MIND_ROOT);
    if (!el || !r) return;
    el.scrollLeft = Math.max(0, r.x * scale - el.clientWidth / 2);
    el.scrollTop = Math.max(0, r.y * scale - el.clientHeight / 2);
  }, [map, fit]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (dir: 1 | -1) => {
    const i = ZOOMS.findIndex((z) => z >= scale - 0.001);
    const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir))];
    setZoom(next);
  };
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as Element).closest(".mm__node")) return;
    const el = box.current!;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    box.current!.scrollLeft = d.left - (e.clientX - d.x);
    box.current!.scrollTop = d.top - (e.clientY - d.y);
  };
  const onUp = () => { drag.current = null; };

  // ── keyboard ──
  const reveal = useCallback((id: string) => {
    const el = pills.current.get(id);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, []);
  const move = (id: string) => { setActive(id); reveal(id); };
  const nextFrom = (id: string, key: string): string => {
    const n = nodeOf(id);
    if (!n) return id;
    const isConcept = (x: MindNode) => conceptAt(x) !== null;
    const nearest = (list: MindNode[]) => list.length ? conceptAt(list.reduce((b, k) => (Math.abs(k.y - n.y) < Math.abs(b.y - n.y) ? k : b)))! : null;
    if (n.id === MIND_ROOT) {                             // the umbrella concept in the middle: out to either side
      const side = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
      return (side && nearest(map.nodes.filter((x) => x.depth === 1 && x.side === side && isConcept(x)))) || id;
    }
    const kids = map.nodes.filter((x) => x.parent === n.id && isConcept(x));
    const outward = key === (n.side === 1 ? "ArrowRight" : "ArrowLeft");
    if (key === "ArrowRight" || key === "ArrowLeft") {
      if (outward && kids.length) return nearest(kids)!;
      if (!outward) {
        const p = n.parent ? at.get(n.parent) : null;
        if (p && isConcept(p)) return conceptAt(p)!;
        // from a main idea towards the middle: across to the nearest main idea on the other side
        return nearest(map.nodes.filter((x) => x.depth === 1 && x.side !== n.side && isConcept(x))) ?? id;
      }
      return id;
    }
    const column = map.nodes.filter((x) => x.side === n.side && x.depth === n.depth && isConcept(x)).sort((a, b) => a.y - b.y);
    const i = column.findIndex((x) => x.id === n.id);
    const j = key === "ArrowUp" ? i - 1 : key === "ArrowDown" ? i + 1 : i;
    return (column[j] && conceptAt(column[j])) || id;
  };
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      move(nextFrom(id, e.key));
    } else if (e.key === "Home" && first) {
      e.preventDefault(); move(first);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); onSelect(id);
    } else if (e.key === "Escape" && selected) {
      e.preventDefault(); onSelect(null);
    }
  };

  const colour = (n: MindNode) => (n.branch < 0 ? undefined : `var(--mm-${n.branch % BRANCHES})`);
  const root = at.get(MIND_ROOT)!;
  const crossLinks = lit ? relations.filter((r) => (r.source === lit || r.target === lit) && nodeOf(r.source) && nodeOf(r.target)
    && !map.tree.has([r.source, r.target].sort().join("|"))) : [];
  const litNode = lit ? nodeOf(lit) : undefined;
  const inTree = (n: MindNode) => !!litNode && (n === litNode || n.parent === litNode.id || litNode.parent === n.id);

  return (
    <div className="mm">
      <div className="mm__tools" role="toolbar" aria-label="Zoom">
        <Button size="sm" icon variant="ghost" onClick={() => step(-1)} aria-label="Zoom out" title="Zoom out" disabled={scale <= ZOOMS[0] + 0.001}><Minus size={15} /></Button>
        <span className="mm__zoom" aria-live="polite">{Math.round(scale * 100)}%</span>
        <Button size="sm" icon variant="ghost" onClick={() => step(1)} aria-label="Zoom in" title="Zoom in" disabled={scale >= ZOOMS[ZOOMS.length - 1] - 0.001}><Plus size={15} /></Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom(null)} pressed={zoom === null}>Fit</Button>
      </div>
      <div ref={box} className="mm__box"
           onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <svg className="mm__svg" viewBox={`0 0 ${map.width} ${map.height}`} width={Math.round(map.width * scale)} height={Math.round(map.height * scale)}
             role="group" aria-roledescription="concept map" aria-label={`Concept map: ${concepts.length} concepts`} aria-describedby="mm-help">
          <desc id="mm-help">{`${subject} in the middle, its main ideas around it. Arrow keys move between concepts, Enter opens one, Escape closes it.`}</desc>
          <g aria-hidden="true">
            {map.nodes.filter((n) => n.parent).map((n) => {
              const p = at.get(n.parent!)!;
              const dim = !!lit && !inTree(n);
              return <path key={`b-${n.id}`} className="mm__branch" d={link(p, n)} data-depth={Math.min(n.depth, 3)} data-dim={dim || undefined}
                           style={{ stroke: colour(n) }} />;
            })}
            {crossLinks.map((r) => {
              const a = nodeOf(r.source)!, b = nodeOf(r.target)!;
              return (
                <g key={`x-${r.source}|${r.target}`}>
                  <path className="mm__cross" d={arc(a, b)} />
                  {r.label && <text className="mm__rel" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - Math.min(80, Math.hypot(b.x - a.x, b.y - a.y) * 0.25) / 2 - 4}>{r.label}</text>}
                </g>
              );
            })}
            {map.rootConcept ? (
              <text className="mm__caption" x={root.x} y={root.y - root.h / 2 - 12}>{mindLabel(subject)}</text>
            ) : (
              <g className="mm__root">
                <rect x={root.x - root.w / 2} y={root.y - root.h / 2} width={root.w} height={root.h} rx={12} />
                <text x={root.x} y={root.y}>{mindLabel(subject)}</text>
              </g>
            )}
            {at.has(MIND_MORE) && (() => {
              const m = at.get(MIND_MORE)!;
              return (
                <g className="mm__more" style={{ ["--b" as string]: colour(m) }}>
                  <rect x={m.x - m.w / 2} y={m.y - m.h / 2} width={m.w} height={m.h} rx={m.h / 2} />
                  <text x={m.x} y={m.y}>More ideas</text>
                </g>
              );
            })()}
          </g>
          {concepts.map((c) => {
            const n = nodeOf(c.id);
            if (!n) return null;
            const middle = n.id === MIND_ROOT;
            const links = neighbours(c.id, relations).map((x) => byId.get(x)?.name).filter(Boolean);
            const dim = !!lit && lit !== c.id && !litLinks.has(c.id) && !inTree(n);
            const left = n.x - n.w / 2;
            return (
              <g key={c.id} ref={(el) => { if (el) pills.current.set(c.id, el); else pills.current.delete(c.id); }}
                 className={middle ? "mm__node mm__node--root" : "mm__node"} data-depth={Math.min(n.depth, 2)} data-heat={c.heat} data-dim={dim || undefined}
                 data-selected={selected === c.id || undefined} data-lit={lit === c.id || undefined} style={{ ["--b" as string]: colour(n) }}
                 role="button" tabIndex={c.id === current ? 0 : -1} aria-pressed={selected === c.id}
                 aria-label={`${c.name}. ${heatLabel(c.heat)}${c.seen ? `, ${c.correct} of ${c.seen} right` : ""}.` +
                             (links.length ? ` Linked to ${links.join(", ")}.` : "")}
                 onFocus={() => { setFocused(c.id); setActive(c.id); }} onBlur={() => setFocused(null)}
                 onPointerEnter={() => setHovered(c.id)} onPointerLeave={() => setHovered(null)}
                 onClick={() => onSelect(selected === c.id ? null : c.id)} onKeyDown={(e) => onKey(e, c.id)}>
                <title>{c.name}</title>
                <rect className="mm__pill" x={left} y={n.y - n.h / 2} width={n.w} height={n.h} rx={middle ? 12 : n.h / 2} />
                <circle className="mm__dot" cx={left + 16} cy={n.y} r={n.depth === 1 ? 5 : 4.5} />
                <text className="mm__label" x={left + 28} y={n.y}>{mindLabel(c.name)}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
