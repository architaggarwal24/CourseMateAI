"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { useChampion } from "@/hooks/useChampion";
import { useHUDStore } from "@/hooks/useHUD";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { fetchBestiary, fetchBestiaryPage } from "@/lib/arena/api";
import type { BestiaryEntry, BestiaryPage, BestiaryResponse, Move } from "@/lib/arena/types";
import { LOST_PAGES, PAGES, SCRIBE, SEALED_LINES } from "@/lib/bestiary/content";
import { heroById } from "@/lib/pixel/heroes";
import { shortcutBlocked } from "@/lib/keys";
import { tome, tomeCaps } from "@/fonts/tome";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import {
  fightNotes, huntTotals, markSeen, nextQuarry, pendingRituals, readSeen, seenNow, tierMap, writeSeen, type Rituals, type Seen,
} from "@/lib/bestiary/desk";
import { DeskProps, HuntRecordPanel, TierMapPanel } from "./DeskPanels";
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

// ── wear and tear ─────────────────────────────────────────────────────────────────────────────────────────────
/** A small, steady random number from a seed (the same page always has the same tears and stains). */
function rand(seed: number) {
  let h = seed | 0;
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822519) ^ Math.imul(h ^ (h >>> 13), 3266489917); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
export const seedOf = (key: string) => { let h = 2166136261; for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/**
 * The page's outline as a clip-path: ragged on the open edges (the spine side stays straight), and now and then a
 * corner torn away. In percentages, so it fits any page size.
 */
export function tornEdge(seed: number, side: "left" | "right" | "single"): string {
  const r = rand(seed);
  const pts: string[] = [];
  const j = (amp: number) => (r() * amp).toFixed(2);
  const outerRight = side !== "left";                       // the open edge: right on a right page or a single one
  const tornCorner = r() < 0.35 ? (r() < 0.5 ? "top" : "bottom") : null;
  const N = 22;
  // top edge, left to right
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * 100;
    const nearOuter = outerRight ? i >= N - 3 : i <= 3;
    const bite = tornCorner === "top" && nearOuter ? 3.5 + r() * 3 : 0;
    pts.push(`${x.toFixed(2)}% ${(Number(j(0.7)) + bite).toFixed(2)}%`);
  }
  // right edge, top to bottom
  for (let i = 1; i < N; i++) pts.push(`${outerRight ? (100 - Number(j(1.1))).toFixed(2) : "100"}% ${((i / N) * 100).toFixed(2)}%`);
  // bottom edge, right to left
  for (let i = N; i >= 0; i--) {
    const x = (i / N) * 100;
    const nearOuter = outerRight ? i >= N - 3 : i <= 3;
    const bite = tornCorner === "bottom" && nearOuter ? 3.5 + r() * 3 : 0;
    pts.push(`${x.toFixed(2)}% ${(100 - Number(j(0.8)) - bite).toFixed(2)}%`);
  }
  // left edge, bottom to top
  for (let i = N - 1; i > 0; i--) pts.push(`${outerRight ? "0" : Number(j(1.1)).toFixed(2)}% ${((i / N) * 100).toFixed(2)}%`);
  return `polygon(${pts.join(", ")})`;
}

function Paper({ side, children, label, seed, folio }: { side: "left" | "right" | "single"; children?: ReactNode; label?: string; seed: number; folio?: number }) {
  const r = rand(seed + 7);
  const stain = r() < 0.45 ? 1 + Math.floor(r() * 3) : 0;
  return (
    <div className="tome-page" data-side={side} data-stain={stain || undefined} role={label ? "group" : undefined} aria-label={label}
      style={{ clipPath: tornEdge(seed, side), "--stain-x": `${Math.round(15 + r() * 70)}%`, "--stain-y": `${Math.round(15 + r() * 70)}%` } as CSSProperties}>
      {children}
      {folio !== undefined && <p className="tome-folio-mark" aria-hidden="true">{folio}</p>}
    </div>
  );
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

function ContentsPage({ data, goTo, pageOf }: { data: BestiaryResponse; goTo: (species: string) => void; pageOf: (species: string) => number }) {
  return (
    <nav className="tome-contents" aria-label="Contents">
      <h3 className="tome-h">Contents</h3>
      {data.tiers.map((t) => (
        <section key={t.tier} className="tome-contents__tier">
          <h4>Tier {ROMAN[t.tier]} · {t.open ? t.name : "Sealed"} <span>{t.open ? `${t.beaten}/${t.total}` : ""}</span></h4>
          <ul>
            {data.creatures.filter((c) => c.tier === t.tier).map((c) => (
              <li key={c.species}>
                <button type="button" className="tome-link" onClick={() => goTo(c.species)}>
                  <span className="tome-link__name">
                    {c.open ? c.name : <><span aria-hidden="true">· · ·</span><span className="sr-only">A sealed page</span></>}
                    {c.defeated && <><span aria-hidden="true"> ✦</span><span className="sr-only">, beaten</span></>}
                    <span className="sr-only">, page {pageOf(c.species)}</span>
                  </span>
                  <span className="tome-link__dots" aria-hidden="true" />
                  <span className="tome-link__page" aria-hidden="true">{pageOf(c.species)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

/** How much tougher a tier makes a creature: "+15% HP", "base". */
const scaleText = (x: number, what: string, more: boolean) => (x === 1 ? `base ${what}` : `${more ? "+" : "−"}${Math.round(Math.abs(x - 1) * 100)}% ${what}`);

/**
 * A creature's sketch, alive (round 7): drawn in brown ink on the page, it takes its colours when you point at it,
 * and tapping it provokes it into a strike. Only on the open page (not on a leaf that's turning).
 */
function LiveSketch({ c }: { c: BestiaryEntry }) {
  const [anim, setAnim] = useState<"idle" | "attack" | "cast">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const provoke = () => {
    setAnim((a) => (a === "attack" ? "cast" : "attack"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAnim("idle"), 1100);
  };
  return (
    <button type="button" className="tome-art__sketch tome-art__sketch--live" onClick={provoke} aria-label={`Provoke the ${c.name}`} data-anim={anim}>
      <PixelSprite boss={c.species} flip anim={anim} className="tome-art__sprite" />
    </button>
  );
}

function ArtPage({ c, nextTierHint, live, canHunt }: { c: BestiaryEntry; nextTierHint: string | null; live?: boolean; canHunt?: boolean }) {
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
  const notes = fightNotes(c);
  return (
    <div className="tome-art">
      <p className="tome-tier">Tier {ROMAN[c.tier]} · {c.origin} myth</p>
      {live ? <LiveSketch c={c} /> : (
        <div className="tome-art__sketch" aria-hidden="true"><PixelSprite boss={c.species} flip anim="idle" className="tome-art__sprite" /></div>
      )}
      <h3 className="tome-art__name">{c.name}</h3>
      <p className="tome-art__epithet">{text?.epithet}</p>
      {c.mastery !== "none" && <p className="tome-seal" data-mastery={c.mastery}>{MASTERY[c.mastery]}</p>}
      <dl className="tome-record" aria-label="Your record">
        <div><dt>Fights</dt><dd>{r?.fights ?? 0}</dd></div>
        <div><dt>Victories</dt><dd>{r?.wins ?? 0}</dd></div>
        <div><dt>Best time</dt><dd>{mmss(r?.best_seconds ?? null)}</dd></div>
        <div><dt>Best aim</dt><dd>{r?.best_accuracy !== null && r?.best_accuracy !== undefined ? `${r.best_accuracy}%` : "-"}</dd></div>
      </dl>
      {c.stats && (
        <div className="tome-stats">
          <p><span className="tome-label">Hide.</span> {scaleText(c.stats.hp_scale, "HP", true)} · {scaleText(c.stats.time_scale, "time per question", false)}</p>
          <p><span className="tome-label">Blows.</span> {c.stats.attacks.join(", ")}. <span className="tome-label">Special.</span> {c.stats.special}.</p>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="tome-notes" aria-label="Fight notes">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {canHunt && (
        <Link className="tome-hunt" href={ROUTES.heroHunt(c.species)}>{c.defeated ? "Hunt it again" : "Hunt it"}</Link>
      )}
    </div>
  );
}

/** The unlock rituals (round 7): a newly written page burns its ink in; a newly unsealed tier's wax seal cracks. */
function Ritual({ kind, reduce, onDone }: { kind: "burn" | "seal"; reduce: boolean; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, reduce ? 0 : kind === "seal" ? RITUAL_MS.seal : RITUAL_MS.burn);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (reduce) return null;
  return kind === "burn" ? (
    <div className="tome-burn" aria-hidden="true"><span className="tome-burn__edge" /></div>
  ) : (
    <div className="tome-wax" aria-hidden="true"><span className="tome-wax__half" data-half="l" /><span className="tome-wax__half" data-half="r" /></div>
  );
}
export const RITUAL_MS = { burn: 2300, seal: 1700 } as const;

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

// ── turning pages ─────────────────────────────────────────────────────────────────────────────────────────────
/** How long one leaf takes to turn, and how far behind each other the leaves of a thick stack follow. */
export const TURN_MS = 760;
export const STACK_GAP = 70;
/** A jump of many pages is shown as a stack of at most this many leaves turning together. */
export const STACK_MAX = 5;
/** Vertical strips per leaf: each bends a little more than the one before, so the page curves. */
const STRIPS = 10;
/** How much a leaf bends at the height of its turn (degrees, spread over its strips). */
const BEND = 85;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/**
 * Where each leaf of a turn is (0 = lying on the right, 1 = lying on the left) at `clock` (0..1 of the whole turn).
 * Leaf 0 is the top of the stack on the right; forward, it lifts first; back, the leaf on top of the left stack (the
 * last one) lifts first. One leaf is an ordinary page turn.
 */
export function leafProgress(clock: number, n: number, forward: boolean): number[] {
  const total = TURN_MS + (n - 1) * STACK_GAP;
  const t = (forward ? clock : 1 - clock) * total;
  return Array.from({ length: n }, (_, k) => clamp01((t - k * STACK_GAP) / TURN_MS));
}

/** The angle of each strip of a leaf at `progress`, and how lit it is (light from the front). */
export function leafPose(progress: number, wobble = 0) {
  const e = easeInOut(progress);
  const hinge = -180 * e;
  const step = -((BEND + wobble) * Math.sin(Math.PI * e)) / STRIPS;
  return Array.from({ length: STRIPS }, (_, i) => {
    const world = ((hinge + step * i) * Math.PI) / 180;
    return { angle: i === 0 ? hinge : step, shade: 0.72 + 0.28 * Math.abs(Math.cos(world)) };
  });
}

/**
 * One leaf, drawn as strips hinged to each other: the first turns about the spine, each next one bends a little
 * further, so the leaf curls like paper. Front and back are whole pages; each strip shows its slice of them. The
 * strips are drawn once per turn; the book moves them (setPose) on every frame without React.
 */
function Strip({ i, front, back, refs }: { i: number; front: ReactNode; back: ReactNode; refs: (HTMLDivElement | null)[] }) {
  const slice = (k: number): CSSProperties => ({ width: `${STRIPS * 100}%`, transform: `translateX(${(-k / STRIPS) * 100}%)` });
  return (
    <div className="tome-strip" data-first={i === 0 || undefined} ref={(el) => { refs[i] = el; }}>
      <div className="tome-strip__face"><div className="tome-strip__slice" style={slice(i)}>{front}</div></div>
      <div className="tome-strip__face tome-strip__face--back"><div className="tome-strip__slice" style={slice(STRIPS - 1 - i)}>{back}</div></div>
      {i < STRIPS - 1 && <Strip i={i + 1} front={front} back={back} refs={refs} />}
    </div>
  );
}

function CurlLeaf({ front, back, single, refs, leafRef }: { front: ReactNode; back: ReactNode; single: boolean; refs: (HTMLDivElement | null)[]; leafRef: (el: HTMLDivElement | null) => void }) {
  return (
    <div className="tome-leaf" data-single={single || undefined} ref={leafRef} aria-hidden="true" inert>
      <Strip i={0} front={front} back={back} refs={refs} />
    </div>
  );
}

/** Put a leaf's strips where they are at `progress` (no React render). */
function setPose(strips: (HTMLDivElement | null)[], progress: number, wobble: number) {
  const pose = leafPose(progress, wobble);
  strips.forEach((el, i) => {
    if (!el) return;
    el.style.transform = `rotateY(${pose[i].angle.toFixed(2)}deg)`;
    el.style.setProperty("--shade", pose[i].shade.toFixed(3));
  });
}

type Turn = { from: number; to: number };

/**
 * The Bestiary as a book: a spread of two pages on a wide screen, one page on a phone. The arrow keys turn a page, and
 * so does dragging it (mouse or finger) past a third of the way; the leaf curls over the spine. Choosing a creature
 * in the contents turns all the pages up to it at once, as a thick stack. Reduced motion turns pages at once.
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
  // the turn's clock (0..1) and the leaves' strips live outside React: a frame moves them directly
  const clock = useRef(0);
  const dragging = useRef(false);
  const stripRefs = useRef<(HTMLDivElement | null)[][]>([]);
  const leafEls = useRef<(HTMLDivElement | null)[]>([]);
  const raf = useRef(0);

  // the unlock rituals still to play (pages written, tiers unsealed since this device last opened the book)
  const [rituals, setRituals] = useState<Rituals>({ burn: [], seals: [] });
  const seen = useRef<Seen | null>(null);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (guest) return;
    let alive = true;
    fetchBestiary().then((d) => {
      if (!alive) return;
      setData(d);
      const before = readSeen();
      if (!before) { seen.current = seenNow(d); writeSeen(seen.current); return; }   // first visit: nothing to replay
      seen.current = before;
      setRituals(pendingRituals(d, before));
    }).catch(() => { /* the visitor's book stays */ });
    return () => { alive = false; };
  }, [guest]);
  const finishRitual = useCallback((done: { species?: string; tier?: number }, line: string) => {
    seen.current = markSeen(seen.current ?? { written: [], tiers: [] }, done);
    writeSeen(seen.current);
    setRituals((r) => ({ burn: r.burn.filter((x) => x !== done.species), seals: r.seals.filter((t) => t !== done.tier) }));
    setAnnounce(line);
  }, []);

  const all = useMemo(() => leaves(data.creatures), [data.creatures]);
  const pages: [Leaf, Leaf | null][] = useMemo(() => (wide ? spreads(all) : all.map((l) => [l, null] as [Leaf, Leaf | null])), [all, wide]);
  // switching between one and two pages keeps the reader on the same creature
  const lastWide = useRef(wide);
  useEffect(() => {
    if (lastWide.current === wide) return;
    setTurn(null);
    setAt((i) => (wide ? Math.floor(i / 2) : i * 2));
    lastWide.current = wide;
  }, [wide]);
  const index = Math.min(at, pages.length - 1);

  /** Draw the turn at the current clock: each leaf's curl, which leaf lies on top, the shadow under them. */
  const paint = useCallback(() => {
    if (!turn) return;
    const forward = turn.to > turn.from;
    const n = Math.min(STACK_MAX, Math.abs(turn.to - turn.from));
    const prog = leafProgress(clock.current, n, forward);
    prog.forEach((p, k) => {
      setPose(stripRefs.current[k] ?? [], p, (k % 3) * 6 - 6);
      const leaf = leafEls.current[k];
      if (leaf) leaf.style.zIndex = String(10 + (wide ? (p < 0.5 ? n - k : n + k) : n - k));
    });
    bookRef.current?.style.setProperty("--turn-shadow", Math.max(...prog.map((p) => Math.sin(Math.PI * p))).toFixed(3));
  }, [turn, wide]);
  useLayoutEffect(() => { paint(); }, [paint]);

  /** Run the clock to its end (1: the new page) or back to its start (0: a drag let go early). */
  const settle = useCallback((goal: 0 | 1, t: Turn) => {
    cancelAnimationFrame(raf.current);
    const n = Math.min(STACK_MAX, Math.abs(t.to - t.from));
    const total = TURN_MS + (n - 1) * STACK_GAP;
    const from = clock.current, begin = performance.now();
    const dur = Math.max(80, Math.abs(goal - from) * total);
    const tick = (now: number) => {
      const k = clamp01((now - begin) / dur);
      clock.current = from + (goal - from) * k;
      if (k >= 1) {
        if (goal === 1) setAt(t.to);
        setTurn(null);
        return;
      }
      paint();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [paint]);
  // a turn that starts by itself (a key, a button, the contents) runs at once
  const autoRun = useRef(false);
  useEffect(() => {
    if (turn && autoRun.current) { autoRun.current = false; settle(1, turn); }
  }, [turn, settle]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const byId = useMemo(() => new Map(data.creatures.map((c) => [c.species, c])), [data.creatures]);
  const visible = useMemo(() => {
    const ids = new Set<string>();
    const spans = turn ? [pages[turn.from], pages[turn.to]] : [pages[index]];
    for (const sp of spans) for (const l of sp ?? []) if (l && (l.kind === "art" || l.kind === "text")) ids.add(l.species);
    return [...ids];
  }, [pages, index, turn]);
  // the concepts a creature tested you on are read when its page opens (once)
  useEffect(() => {
    if (guest) return;
    for (const s of visible) {
      const c = byId.get(s);
      if (!c?.defeated || details[s]) continue;
      fetchBestiaryPage(s).then((p) => setDetails((d) => ({ ...d, [s]: p }))).catch(() => setDetails((d) => ({ ...d, [s]: { ...c, concepts: [] } })));
    }
  }, [visible, byId, details, guest]);

  /** Turn from the open spread to `target`: one leaf, or a stack of them for a long way. */
  const turnTo = useCallback((target: number) => {
    if (turn) return;
    const to = Math.max(0, Math.min(pages.length - 1, target));
    if (to === index) return;
    if (reduce) { setAt(to); return; }
    clock.current = 0;
    autoRun.current = true;
    setTurn({ from: index, to });
  }, [turn, pages.length, index, reduce]);
  const flip = useCallback((dir: 1 | -1) => turnTo(index + dir), [turnTo, index]);

  const artIndex = useCallback((species: string) => all.findIndex((l) => l.kind === "art" && l.species === species), [all]);
  const goTo = useCallback((species: string) => {
    const i = artIndex(species);
    if (i >= 0) turnTo(wide ? Math.floor(i / 2) : i);
  }, [artIndex, turnTo, wide]);
  /** The tier's first page (the tier map). */
  const firstOfTier = useCallback((tier: number) => data.creatures.find((c) => c.tier === tier)?.species, [data.creatures]);
  const goToTier = useCallback((tier: number) => { const sp = firstOfTier(tier); if (sp) goTo(sp); }, [firstOfTier, goTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e)) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); flip(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); flip(-1); }
      else if (e.key === "Home") { e.preventDefault(); turnTo(wide ? 0 : 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, turnTo, wide]);

  // dragging a page: left turns forward, right turns back; let go past a third and it finishes the turn
  const onPointerDown = (e: React.PointerEvent) => {
    if (turn || (e.target as HTMLElement).closest("button, a")) return;
    drag.current = { x: e.clientX, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) < 6 && !dragging.current) return;
    const dir: 1 | -1 = dx < 0 ? 1 : -1;
    if (turn && !dragging.current) return;                                // a turn already running
    if (dragging.current && turn && Math.sign(turn.to - turn.from) !== dir) return;
    if ((dir === 1 && index >= pages.length - 1) || (dir === -1 && index <= 0)) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const width = (bookRef.current?.clientWidth ?? 600) / (wide ? 2 : 1);
    clock.current = Math.min(1, Math.abs(dx) / width);
    if (!dragging.current) { dragging.current = true; setTurn({ from: index, to: index + dir }); }
    else paint();
  };
  const onPointerUp = () => {
    drag.current = null;
    if (!dragging.current || !turn) { dragging.current = false; return; }
    dragging.current = false;
    const done = clock.current > 0.33;
    if (reduce) { if (done) setAt(turn.to); setTurn(null); return; }
    settle(done ? 1 : 0, turn);
  };

  const folioOf = (l: Leaf) => all.indexOf(l) + 1;
  /** `live`: the page lies open (not on a turning leaf): its creature moves, and its ritual plays. */
  const render = (l: Leaf | null, side: "left" | "right" | "single", live = false): ReactNode => {
    if (!l) return <Paper side={side} seed={seedOf(`blank-${side}`)} />;
    const seed = seedOf(`${l.kind}-${"species" in l ? l.species : ""}`);
    const folio = folioOf(l);
    if (l.kind === "title") return <Paper side={side} seed={seed}><TitlePage data={data} /></Paper>;
    if (l.kind === "contents") return <Paper side={side} seed={seed} folio={folio}><ContentsPage data={data} goTo={goTo} pageOf={(sp) => artIndex(sp) + 1} /></Paper>;
    if (l.kind === "end") return <Paper side={side} seed={seed} folio={folio}><EndPage /></Paper>;
    const c = byId.get(l.species)!;
    const label = c.open ? `${c.name}${l.kind === "art" ? "" : ", its page"}` : "A sealed page";
    const sealHere = live && l.kind === "art" && rituals.seals.includes(c.tier) && firstOfTier(c.tier) === c.species;
    const burnHere = live && !sealHere && rituals.burn.includes(c.species);
    const ritual = sealHere ? (
      <Ritual key={`seal-${c.tier}`} kind="seal" reduce={reduce} onDone={() => finishRitual({ tier: c.tier }, `The seal breaks: tier ${ROMAN[c.tier]} is open.`)} />
    ) : burnHere ? (
      <Ritual key={`burn-${c.species}-${l.kind}`} kind="burn" reduce={reduce} onDone={() => finishRitual({ species: c.species }, `The ${c.name}'s page is written in full.`)} />
    ) : null;
    if (l.kind === "art") {
      const prev = data.tiers.find((t) => t.tier === c.tier - 1);
      const hint = !c.open && prev ? `Beat ${prev.opens_next_at ?? 2} creatures of tier ${ROMAN[prev.tier]} to break this seal (${prev.beaten} so far).` : null;
      return <Paper side={side} label={label} seed={seed} folio={folio}><ArtPage c={c} nextTierHint={hint} live={live} canHunt={live && !guest} />{ritual}</Paper>;
    }
    return <Paper side={side} label={label} seed={seed} folio={folio}><TextPage c={c} page={details[l.species] ?? null} champion={champion} />{ritual}</Paper>;
  };
  const blank = (side: "left" | "right" | "single", k: number) => <Paper side={side} seed={seedOf(`leaf-${k}-${side}`)} />;

  // what lies under the turning leaves, and the leaves themselves
  let base: ReactNode;
  let leavesNode: ReactNode = null;
  if (turn) {
    const lo = Math.min(turn.from, turn.to), hi = Math.max(turn.from, turn.to);
    const n = Math.min(STACK_MAX, hi - lo);
    const ks = Array.from({ length: n }, (_, k) => k);
    stripRefs.current = ks.map(() => []);
    const leafRef = (k: number) => (el: HTMLDivElement | null) => { leafEls.current[k] = el; };
    if (wide) {
      base = <>{render(pages[lo][0], "left")}{render(pages[hi][1], "right")}</>;
      leavesNode = ks.map((k) => (
        <CurlLeaf key={`${turn.from}-${turn.to}-${k}`} single={false} refs={stripRefs.current[k]} leafRef={leafRef(k)}
          front={k === 0 ? render(pages[lo][1], "right") : blank("right", k)}
          back={k === n - 1 ? render(pages[hi][0], "left") : blank("left", k)} />
      ));
    } else {
      base = render(pages[hi][0], "single");
      leavesNode = ks.map((k) => (
        <CurlLeaf key={`${turn.from}-${turn.to}-${k}`} single refs={stripRefs.current[k]} leafRef={leafRef(k)}
          front={k === 0 ? render(pages[lo][0], "single") : blank("single", k)} back={blank("single", k + 100)} />
      ));
    }
  } else {
    const cur = pages[index];
    base = wide ? <>{render(cur[0], "left", true)}{render(cur[1], "right", true)}</> : render(cur[0], "single", true);
  }

  const shown = turn ? turn.to : index;
  const stops = tierMap(data);
  const totals = huntTotals(data);
  // fresh ink: what changed since you last opened the book, with a way to turn straight to it
  const fresh = [
    ...rituals.seals.map((t) => ({ key: `t${t}`, label: `Tier ${ROMAN[t]} unsealed`, go: () => goToTier(t) })),
    ...rituals.burn.map((sp) => ({ key: sp, label: `${byId.get(sp)?.name ?? "A page"} written in full`, go: () => goTo(sp) })),
  ];
  return (
    <div className={`tome-desk ${tome.variable} ${tomeCaps.variable}`}>
      <DeskProps />
      <div className="tome-desk__grid">
        <section className="tome" aria-labelledby="tome-title">
          <h2 id="tome-title" className="sr-only">Bestiary book</h2>
          {fresh.length > 0 && (
            <div className="tome-fresh" role="status">
              <span className="tome-fresh__label">Fresh ink</span>
              {fresh.map((f) => <button key={f.key} type="button" className="tome-fresh__item" onClick={f.go}>{f.label}</button>)}
            </div>
          )}
          <div ref={bookRef} className="tome-book" data-wide={wide || undefined} data-turning={turn ? "true" : undefined}
               onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <div className="tome-stack" data-side="left" aria-hidden="true" style={{ "--depth": Math.min(8, shown + 1) } as CSSProperties} />
            <div className="tome-stack" data-side="right" aria-hidden="true" style={{ "--depth": Math.min(8, pages.length - shown) } as CSSProperties} />
            {base}
            {turn && <div className="tome-cast" aria-hidden="true" />}
            {leavesNode}
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
          <p className="tome-help">Arrow keys or drag the page to turn it. Tap a creature to provoke it. Choose one in the contents to turn straight to it.</p>
        </section>
        <TierMapPanel stops={stops} onPick={goToTier} />
        <HuntRecordPanel totals={totals} quarry={nextQuarry(data)} canHunt={!guest} onTurnTo={goTo} />
      </div>
      <p className="sr-only" aria-live="polite">{announce}</p>
    </div>
  );
}
