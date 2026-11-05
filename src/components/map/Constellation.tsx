"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { heatLabel, layoutConstellation, neighbours, starInDirection, type MapConcept, type MapRelation } from "@/lib/study/conceptMap";

const W = 760, H = 470;
const RADIUS: Record<number, number> = { 3: 12, 2: 9, 1: 7 };

// Faint background stars: fixed, so the sky never shifts between renders.
const DUST = Array.from({ length: 70 }, (_, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453, b = Math.sin(i * 78.233) * 12345.678;
  return { x: (a - Math.floor(a)) * W, y: (b - Math.floor(b)) * H, r: i % 5 === 0 ? 1.4 : 0.8 };
});

/**
 * The concept map as a calm star chart: one star per concept (size = how central, colour and ring = mastery heat),
 * lines for the relations. Keyboard: Tab reaches the map (one stop), the arrow keys move to the nearest linked
 * star in that direction, Home goes to the most central one, Enter / Space opens the star's panel, Esc closes it.
 */
export default function Constellation({ concepts, relations, selected, onSelect }: {
  concepts: MapConcept[]; relations: MapRelation[]; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const at = useMemo(() => layoutConstellation(concepts, relations), [concepts, relations]);
  const byId = useMemo(() => new Map(concepts.map((c) => [c.id, c])), [concepts]);
  const first = concepts[0]?.id ?? null;                 // the server sorts the most central first
  const [focused, setFocused] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(selected ?? first);
  const stars = useRef(new Map<string, SVGGElement>());
  const current = active && byId.has(active) ? active : first;
  const lit = focused ?? selected;
  const litLinks = new Set(lit ? neighbours(lit, relations) : []);

  const move = (id: string) => { setActive(id); stars.current.get(id)?.focus(); };
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      move(starInDirection(id, e.key, at, relations));
    } else if (e.key === "Home" && first) {
      e.preventDefault(); move(first);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); onSelect(id);
    } else if (e.key === "Escape" && selected) {
      e.preventDefault(); onSelect(null);
    }
  };

  const px = (id: string) => ({ x: at[id].x * W, y: at[id].y * H });
  return (
    <svg className="cmap" viewBox={`0 0 ${W} ${H}`} role="group" aria-roledescription="concept map"
         aria-label={`Concept map: ${concepts.length} concepts`} aria-describedby="cmap-help">
      <desc id="cmap-help">Arrow keys move between linked concepts, Enter opens one, Escape closes it.</desc>
      <g aria-hidden="true">
        {DUST.map((d, i) => <circle key={i} className="cmap__dust" cx={d.x} cy={d.y} r={d.r} />)}
        {relations.map((r) => {
          if (!at[r.source] || !at[r.target]) return null;
          const a = px(r.source), b = px(r.target);
          const on = lit === r.source || lit === r.target;
          return (
            <g key={`${r.source}|${r.target}`}>
              <line className="cmap__line" data-on={on || undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              {on && r.label && <text className="cmap__rel" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6}>{r.label}</text>}
            </g>
          );
        })}
      </g>
      {concepts.map((c) => {
        if (!at[c.id]) return null;
        const { x, y } = px(c.id);
        const r = RADIUS[c.importance] ?? 8;
        const links = neighbours(c.id, relations).map((n) => byId.get(n)?.name).filter(Boolean);
        const dim = !!lit && lit !== c.id && !litLinks.has(c.id);
        return (
          <g key={c.id} ref={(el) => { if (el) stars.current.set(c.id, el); else stars.current.delete(c.id); }}
             className="cmap__star" data-heat={c.heat} data-dim={dim || undefined} data-selected={selected === c.id || undefined}
             role="button" tabIndex={c.id === current ? 0 : -1} aria-pressed={selected === c.id}
             aria-label={`${c.name}. ${heatLabel(c.heat)}${c.seen ? `, ${c.correct} of ${c.seen} right` : ""}.` +
                         (links.length ? ` Linked to ${links.join(", ")}.` : "")}
             onFocus={() => { setFocused(c.id); setActive(c.id); }} onBlur={() => setFocused(null)}
             onClick={() => onSelect(selected === c.id ? null : c.id)} onKeyDown={(e) => onKey(e, c.id)}>
            <circle className="cmap__hit" cx={x} cy={y} r={Math.max(22, r + 12)} />
            <circle className="cmap__ring" cx={x} cy={y} r={r + 5} />
            <circle className="cmap__core" cx={x} cy={y} r={r} />
            <text className="cmap__label" data-major={c.importance >= 3 || undefined} x={x} y={y + r + 18}>{c.name}</text>
          </g>
        );
      })}
    </svg>
  );
}
