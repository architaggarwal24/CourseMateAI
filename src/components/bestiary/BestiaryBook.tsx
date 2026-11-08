"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { useChampion } from "@/hooks/useChampion";
import { useHUDStore } from "@/hooks/useHUD";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { fetchBestiary, fetchBestiaryPage } from "@/lib/arena/api";
import type { BestiaryEntry, BestiaryPage, BestiaryResponse, Move } from "@/lib/arena/types";
import { LOST_PAGES, PAGES, SCRIBE, SEALED_LINES } from "@/lib/bestiary/content";
import { heroById } from "@/lib/pixel/heroes";
import { shortcutBlocked } from "@/lib/keys";
import "./book.css";

// ── pages ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type Leaf = { kind: "title" } | { kind: "contents" } | { kind: "art"; species: string } | { kind: "text"; species: string } | { kind: "end" };

/** The book in reading order: title, contents, then two pages per creature (its sketch, then its words), the end. */
export function leaves(creatures: { species: string }[]): Leaf[] {
  return [{ kind: "title" }, { kind: "contents" }, ...creatures.flatMap((c) => [{ kind: "art", species: c.species } as Leaf, { kind: "text", species: c.species } as Leaf]), { kind: "end" }];
}
/** Two pages side by side on a wide screen (title + contents, then each creature's sketch + words). */
export function spreads(all: Leaf[]): [Leaf, Leaf | null][] {
  const out: [Leaf, Leaf | null][] = [];
  for (let i = 0; i < all.length; i += 2) out.push([all[i], all[i + 1] ?? null]);
  return out;
}

const ROMAN = ["", "I", "II", "III", "IV"];
const MOVE: Record<Move, string> = { strike: "Strike", jab: "Jab", heavy: "Heavy", guard: "Guard" };
const MASTERY = { none: "", bronze: "Bronze seal", silver: "Silver seal", gold: "Gold seal" } as const;
const mmss = (s: number | null) => (s === null ? "-" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** The order of the book, and a visitor's view before (or without) the server's: tier I open. */
function fallback(): BestiaryResponse {
  const TIER: Record<string, number> = { minotaur: 1, cyclops: 1, oni: 1, kitsune: 1, naga: 2, rakshasa: 2, sphinx: 2, fenrir: 2, hydra: 3, kraken: 3, ammit: 3, simurgh: 4, jormungandr: 4 };
  const NAME: Record<string, [string, string]> = { minotaur: ["Minotaur", "Greek"], cyclops: ["Cyclops", "Greek"], oni: ["Oni", "Japanese"], kitsune: ["Kitsune", "Japanese"] };
  const names = ["", "Beasts of the Wilds", "Tricksters and Hunters", "Ancient Horrors", "World-Enders"];
  return {
    tiers: [1, 2, 3, 4].map((t) => ({ tier: t, name: names[t], open: t === 1, beaten: 0, total: Object.values(TIER).filter((x) => x === t).length, opens_next_at: t < 4 ? 2 : null })),
    creatures: Object.keys(TIER).map((s) => ({ species: s, tier: TIER[s], open: TIER[s] === 1, met: false, defeated: false, name: NAME[s]?.[0] ?? null,
      origin: NAME[s]?.[1] ?? null, teaser_topic: null, mastery: "none", record: null, bane: null })),
  };
}

function Paper({ side, children, label }: { side: "left" | "right" | "single"; children: ReactNode; label?: string }) {
  return <div className="tome-page" data-side={side} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

function TitlePage({ data }: { data: BestiaryResponse }) {
  const written = data.creatures.filter((c) => c.defeated).length;
  return (
    <div className="tome-title">
      <p className="tome-title__over">Being a true account of</p>
      <h2 className="tome-title__name">The Bestiary</h2>
      <p className="tome-title__over">the creatures that guard all knowing</p>
      <p className="tome-title__by">as set down by {SCRIBE}</p>
      <p className="tome-title__count"><b>{written}</b> of {data.creatures.length} pages written in full</p>
    </div>
  );
}

function ContentsPage({ data, goTo }: { data: BestiaryResponse; goTo: (species: string) => void }) {
  return (
    <nav className="tome-contents" aria-label="Contents">
      <h3 className="tome-h">Contents</h3>
      {data.tiers.map((t) => (
        <section key={t.tier} className="tome-contents__tier">
          <h4>Tier {ROMAN[t.tier]} · {t.open ? t.name : "Sealed"} <span>{t.open ? `${t.beaten}/${t.total}` : ""}</span></h4>
          <ul>
            {data.creatures.filter((c) => c.tier === t.tier).map((c) => (
              <li key={c.species}>
                <button type="button" className="tome-link" onClick={() => goTo(c.species)} aria-label={c.open ? `${c.name}, page` : "A sealed page"}>
                  {c.open ? c.name : "· · ·"}{c.defeated ? " ✦" : ""}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function ArtPage({ c, nextTierHint }: { c: BestiaryEntry; nextTierHint: string | null }) {
  const text = PAGES[c.species];
  if (!c.open) {
    return (
      <div className="tome-art tome-art--sealed">
        <p className="tome-tier">Tier {ROMAN[c.tier]}</p>
        <div className="tome-art__sketch" aria-hidden="true"><PixelSprite boss={c.species} flip className="tome-art__sprite tome-art__sprite--sealed" /></div>
        <h3 className="tome-art__name">? ? ?</h3>
        <p className="tome-art__teaser">
          {c.teaser_topic ? <>Something stirs when you study <b>{c.teaser_topic}</b>…</> : SEALED_LINES[c.species.length % SEALED_LINES.length]}
        </p>
        {nextTierHint && <p className="tome-art__hint">{nextTierHint}</p>}
      </div>
    );
  }
  const r = c.record;
  return (
    <div className="tome-art">
      <p className="tome-tier">Tier {ROMAN[c.tier]} · {c.origin} myth</p>
      <div className="tome-art__sketch" aria-hidden="true"><PixelSprite boss={c.species} flip className="tome-art__sprite" /></div>
      <h3 className="tome-art__name">{c.name}</h3>
      <p className="tome-art__epithet">{text?.epithet}</p>
      {c.mastery !== "none" && <p className="tome-seal" data-mastery={c.mastery}>{MASTERY[c.mastery]}</p>}
      <dl className="tome-record" aria-label="Your record">
        <div><dt>Fights</dt><dd>{r?.fights ?? 0}</dd></div>
        <div><dt>Victories</dt><dd>{r?.wins ?? 0}</dd></div>
        <div><dt>Best time</dt><dd>{mmss(r?.best_seconds ?? null)}</dd></div>
        <div><dt>Best aim</dt><dd>{r?.best_accuracy !== null && r?.best_accuracy !== undefined ? `${r.best_accuracy}%` : "-"}</dd></div>
      </dl>
      {!c.defeated && <p className="tome-art__hint">Defeat it to finish this page.</p>}
    </div>
  );
}

function TextPage({ c, page, champion }: { c: BestiaryEntry; page: BestiaryPage | null; champion: string }) {
  const text = PAGES[c.species];
  if (!c.open || !text) {
    return (
      <div className="tome-text tome-text--sealed">
        <p className="tome-sealed">This page is sealed.</p>
        <p className="tome-sealed__line">Beat two creatures of the tier before it, and the wax will break.</p>
      </div>
    );
  }
  const hero = heroById(champion);
  const bane = c.bane;
  const elderMet = (c.record?.nightmare_wins ?? 0) > 0;
  return (
    <div className="tome-text">
      <p className="tome-lore"><span className="tome-drop">{text.lore.charAt(0)}</span>{text.lore.slice(1)}</p>
      <p className="tome-fact"><span className="tome-label">From the old texts.</span> {text.fact}</p>
      <h4 className="tome-h4">Tactics</h4>
      <ul className="tome-tactics">
        <li>{text.tactic}</li>
        {bane && (bane.moves ? (
          <li className="tome-bane"><span className="tome-label">Bane.</span> {bane.moves.map((m) => MOVE[m]).join(", then ")}: it staggers and loses its turn.</li>
        ) : (
          <li className="tome-bane tome-bane--clue"><span className="tome-label">Bane.</span> “{bane.clue}”{bane.found_alone ? " You found it; a win will write it in." : ""}</li>
        ))}
      </ul>
      {c.defeated && (
        <>
          <h4 className="tome-h4">It tested you on</h4>
          {page === null ? <p className="tome-muted">Turning the page…</p> : page.concepts.length ? (
            <ul className="tome-concepts">
              {page.concepts.slice(0, 5).map((k) => <li key={k.concept}>{k.concept} <span>{k.right}/{k.asked}</span></li>)}
            </ul>
          ) : <p className="tome-muted">Nothing yet.</p>}
        </>
      )}
      <aside className="tome-elder" data-met={elderMet || undefined}>
        <span className="tome-label">{elderMet ? text.elder.name : "Its Elder form"}.</span>{" "}
        {elderMet ? text.elder.text : "Face it on nightmare to meet it."}
      </aside>
      {LOST_PAGES[c.species] && (c.lost_page ? (
        <aside className="tome-lost" aria-label="Lost page"><span className="tome-label">A lost page.</span> {LOST_PAGES[c.species]}</aside>
      ) : (
        <p className="tome-muted">One page is missing. A Hunt on the quest board may turn it up.</p>
      ))}
      {text.notes[champion] && (
        <p className="tome-margin" aria-label={`${hero.name}'s note`}>{text.notes[champion]} <span>— {hero.name}</span></p>
      )}
    </div>
  );
}

function EndPage() {
  return (
    <div className="tome-end">
      <p className="tome-sealed">Here the Scribe's hand stops.</p>
      <p className="tome-sealed__line">Some pages were torn from this book long ago. Hunts may yet return them.</p>
    </div>
  );
}

// ── the book ──────────────────────────────────────────────────────────────────────────────────────────────────
type Turn = { dir: 1 | -1; progress: number; dragging: boolean };
const TURN_MS = 520;

/**
 * The Bestiary as a book: a spread of two pages on a wide screen, one page on a phone. The arrow keys turn the page,
 * and so does dragging it (mouse or finger) past a third of the way; the page curls over the spine as it turns.
 * Reduced motion turns pages at once.
 */
export default function BestiaryBook() {
  const guest = useHUDStore((s) => s.guestMode);
  const champion = useChampion((s) => s.championId);
  const wide = useMediaQuery("(min-width: 900px)");
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [data, setData] = useState<BestiaryResponse>(fallback);
  const [details, setDetails] = useState<Record<string, BestiaryPage>>({});
  const [at, setAt] = useState(0);
  const [turn, setTurn] = useState<Turn | null>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; id: number } | null>(null);

  useEffect(() => {
    if (guest) return;
    let alive = true;
    fetchBestiary().then((d) => { if (alive) setData(d); }).catch(() => { /* the visitor's book stays */ });
    return () => { alive = false; };
  }, [guest]);

  const all = useMemo(() => leaves(data.creatures), [data.creatures]);
  const pages: [Leaf, Leaf | null][] = useMemo(() => (wide ? spreads(all) : all.map((l) => [l, null] as [Leaf, Leaf | null])), [all, wide]);
  // switching between one and two pages keeps the reader on the same creature
  const lastWide = useRef(wide);
  useEffect(() => {
    if (lastWide.current === wide) return;
    setAt((i) => (wide ? Math.floor(i / 2) : i * 2));
    lastWide.current = wide;
  }, [wide]);
  const index = Math.min(at, pages.length - 1);

  const byId = useMemo(() => new Map(data.creatures.map((c) => [c.species, c])), [data.creatures]);
  const visible = useMemo(() => {
    const ids = new Set<string>();
    for (const l of pages[index] ?? []) if (l && (l.kind === "art" || l.kind === "text")) ids.add(l.species);
    return [...ids];
  }, [pages, index]);
  // the concepts a creature tested you on are read when its page opens (once)
  useEffect(() => {
    if (guest) return;
    for (const s of visible) {
      const c = byId.get(s);
      if (!c?.defeated || details[s]) continue;
      fetchBestiaryPage(s).then((p) => setDetails((d) => ({ ...d, [s]: p }))).catch(() => setDetails((d) => ({ ...d, [s]: { ...c, concepts: [] } })));
    }
  }, [visible, byId, details, guest]);

  const commit = useCallback((dir: 1 | -1) => { setAt((i) => Math.max(0, Math.min(pages.length - 1, i + dir))); setTurn(null); }, [pages.length]);

  const flip = useCallback((dir: 1 | -1) => {
    if (turn) return;
    const target = index + dir;
    if (target < 0 || target >= pages.length) return;
    if (reduce) { commit(dir); return; }
    setTurn({ dir, progress: 0, dragging: false });
    requestAnimationFrame(() => requestAnimationFrame(() => setTurn({ dir, progress: 1, dragging: false })));
  }, [turn, index, pages.length, reduce, commit]);

  // a turn finishes when its curl reaches the far side (or falls back to the start)
  useEffect(() => {
    if (!turn || turn.dragging) return;
    if (turn.progress !== 0 && turn.progress !== 1) return;
    const t = setTimeout(() => (turn.progress === 1 ? commit(turn.dir) : setTurn(null)), TURN_MS);
    return () => clearTimeout(t);
  }, [turn, commit]);

  const goTo = useCallback((species: string) => {
    const i = all.findIndex((l) => l.kind === "art" && l.species === species);
    if (i < 0) return;
    setTurn(null);
    setAt(wide ? Math.floor(i / 2) : i);
  }, [all, wide]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); flip(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); flip(-1); }
      else if (e.key === "Home") { e.preventDefault(); setTurn(null); setAt(wide ? 0 : 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, wide]);

  // dragging a page: left turns forward, right turns back; let go past a third and it finishes the turn
  const onPointerDown = (e: React.PointerEvent) => {
    if (turn || (e.target as HTMLElement).closest("button, a")) return;
    drag.current = { x: e.clientX, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) < 6 && !turn) return;
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    if ((dir === 1 && index >= pages.length - 1) || (dir === -1 && index <= 0)) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const width = (bookRef.current?.clientWidth ?? 600) / (wide ? 2 : 1);
    setTurn({ dir, progress: Math.min(1, Math.abs(dx) / width), dragging: true });
  };
  const onPointerUp = () => {
    drag.current = null;
    setTurn((t) => {
      if (!t || !t.dragging) return t;
      if (reduce) { if (t.progress > 0.33) commit(t.dir); return null; }
      return { ...t, dragging: false, progress: t.progress > 0.33 ? 1 : 0 };
    });
  };

  const render = (l: Leaf | null, side: "left" | "right" | "single"): ReactNode => {
    if (!l) return <Paper side={side}><span /></Paper>;
    if (l.kind === "title") return <Paper side={side}><TitlePage data={data} /></Paper>;
    if (l.kind === "contents") return <Paper side={side}><ContentsPage data={data} goTo={goTo} /></Paper>;
    if (l.kind === "end") return <Paper side={side}><EndPage /></Paper>;
    const c = byId.get(l.species)!;
    const label = c.open ? `${c.name}${l.kind === "art" ? "" : ", its page"}` : "A sealed page";
    if (l.kind === "art") {
      const prev = data.tiers.find((t) => t.tier === c.tier - 1);
      const hint = !c.open && prev ? `Beat ${prev.opens_next_at ?? 2} creatures of tier ${ROMAN[prev.tier]} to break this seal (${prev.beaten} so far).` : null;
      return <Paper side={side} label={label}><ArtPage c={c} nextTierHint={hint} /></Paper>;
    }
    return <Paper side={side} label={label}><TextPage c={c} page={details[l.species] ?? null} champion={champion} /></Paper>;
  };

  const cur = pages[index];
  const next = pages[index + 1];
  const prev = pages[index - 1];
  const p = turn?.progress ?? 0;
  const style = (deg: number): CSSProperties => ({
    transform: `rotateY(${deg}deg)`, transition: turn?.dragging ? "none" : `transform ${TURN_MS}ms cubic-bezier(0.3, 0.1, 0.2, 1)`,
  });

  let base: ReactNode, leaf: ReactNode = null;
  if (wide) {
    const left = turn?.dir === -1 ? prev?.[0] ?? null : cur[0];
    const right = turn?.dir === 1 ? next?.[1] ?? null : cur[1];
    base = <>{render(left, "left")}{render(right, "right")}</>;
    if (turn?.dir === 1 && next) {
      leaf = (
        <div className="tome-leaf" data-dir="next" style={style(-180 * p)} aria-hidden="true">
          <div className="tome-leaf__face">{render(cur[1], "right")}</div>
          <div className="tome-leaf__face tome-leaf__face--back">{render(next[0], "left")}</div>
        </div>
      );
    } else if (turn?.dir === -1 && prev) {
      leaf = (
        <div className="tome-leaf" data-dir="prev" style={style(180 * p)} aria-hidden="true">
          <div className="tome-leaf__face">{render(cur[0], "left")}</div>
          <div className="tome-leaf__face tome-leaf__face--back">{render(prev[1], "right")}</div>
        </div>
      );
    }
  } else {
    base = render(turn?.dir === 1 ? next?.[0] ?? null : cur[0], "single");
    if (turn?.dir === 1) {
      leaf = (
        <div className="tome-leaf tome-leaf--single" style={style(-180 * p)} aria-hidden="true">
          <div className="tome-leaf__face">{render(cur[0], "single")}</div>
          <div className="tome-leaf__face tome-leaf__face--back"><div className="tome-page" data-side="single" /></div>
        </div>
      );
    } else if (turn?.dir === -1 && prev) {
      leaf = (
        <div className="tome-leaf tome-leaf--single" style={style(-180 + 180 * p)} aria-hidden="true">
          <div className="tome-leaf__face">{render(prev[0], "single")}</div>
          <div className="tome-leaf__face tome-leaf__face--back"><div className="tome-page" data-side="single" /></div>
        </div>
      );
    }
  }

  return (
    <section className="tome" aria-labelledby="tome-title">
      <h2 id="tome-title" className="sr-only">Bestiary book</h2>
      <div ref={bookRef} className="tome-book" data-wide={wide || undefined} data-turning={turn ? "true" : undefined}
           onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {base}
        {leaf}
      </div>
      <div className="tome-controls">
        <button type="button" className="tome-turn" onClick={() => flip(-1)} disabled={index === 0 || !!turn} aria-label="Previous page">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="tome-folio" aria-live="polite">{wide ? `Pages ${index * 2 + 1}–${Math.min(all.length, index * 2 + 2)}` : `Page ${index + 1}`} of {all.length}</span>
        <button type="button" className="tome-turn" onClick={() => flip(1)} disabled={index >= pages.length - 1 || !!turn} aria-label="Next page">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <p className="tome-help">Arrow keys or drag the page to turn it.</p>
    </section>
  );
}
