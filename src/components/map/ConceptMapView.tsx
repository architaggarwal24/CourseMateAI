"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brain, Layers, List, Network, RefreshCw, Sparkles, Swords, X } from "@/components/icons";
import StudyToolbar from "@/components/study/StudyToolbar";
import UpgradeCard from "@/components/study/UpgradeCard";
import { Badge, Button, ButtonLink, EmptyState, Skeleton, toast, type BadgeTone } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { ROUTES } from "@/lib/routes";
import {
  buildConceptMap, fetchConceptMap, heatLabel, HEATS, neighbours, type ConceptMap, type Heat, type MapConcept,
} from "@/lib/study/conceptMap";
import MindMap from "./MindMap";
import "./map.css";

export const POLL_MS = 1500;
const SLOW_POLL_MS = 4000;
const PEEK_MS = 600;
const HEAT_TONE: Record<Heat, BadgeTone> = { new: "neutral", weak: "danger", learning: "warning", strong: "success" };
const IMPORTANCE = [{ n: 3, label: "Central" }, { n: 2, label: "Important" }, { n: 1, label: "Supporting" }];

type Phase = "loading" | "ready" | "locked" | "error";

function narrow() {
  try { return window.matchMedia("(max-width: 640px)").matches; } catch { return false; }
}

/**
 * The concept map of the workspace's document or course. Made once per document (one AI pass, cached for every
 * user with the same PDF) only when asked; while it builds the page shows the server's progress line and polls.
 * Drawn as a mind map (keyboard-navigable, zoom and pan), or as a plain list - the default on a phone. A concept's panel
 * offers a quick quiz, flashcards or a boss fight on it.
 */
export default function ConceptMapView({ documentId }: { documentId?: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [map, setMap] = useState<ConceptMap | null>(null);
  const [plan, setPlan] = useState("Sage");
  const [view, setView] = useState<"graph" | "list">(() => (narrow() ? "list" : "graph"));
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const polls = useRef(0);

  const load = useCallback(async () => {
    if (!documentId) return;
    try {
      const m = await fetchConceptMap(documentId);
      setMap(m);
      setPhase("ready");
    } catch (e) {
      if (e instanceof ApiError && e.code === "feature_locked") {
        setPlan(String(e.details?.required_tier_name ?? "Sage"));
        setPhase("locked");
      } else {
        setPhase("error");
      }
    }
  }, [documentId]);

  useEffect(() => { setPhase("loading"); setMap(null); setSelected(null); void load(); }, [load]);

  // While it builds: ask again, a little slower after a while (a reasoning model can take minutes).
  const building = map?.status === "building";
  useEffect(() => {
    if (!building) { polls.current = 0; return; }
    const t = setTimeout(() => { polls.current += 1; void load(); }, polls.current > 20 ? SLOW_POLL_MS : POLL_MS);
    return () => clearTimeout(t);
  }, [building, map, load]);

  const build = async () => {
    if (!documentId) return;
    setStarting(true);
    // The server makes the map inside this request; meanwhile the page polls GET for its progress line.
    const peek = setTimeout(() => void load(), PEEK_MS);
    try {
      setMap(await buildConceptMap(documentId));
    } catch (e) {
      toast.apiError(e, { onRetry: () => void build() });
    } finally {
      clearTimeout(peek);
      setStarting(false);
    }
  };

  const concepts = map?.concepts ?? [];
  const concept = concepts.find((c) => c.id === selected) ?? null;
  const docNames = useMemo(() => new Map((map?.documents ?? []).map((d) => [d.id, d.name])), [map]);
  const hasMap = concepts.length > 0;
  const canBuild = !!map && !building && (map.status === "none" || map.status === "failed" || map.status === "partial");

  const subtitle = !map ? "How the ideas in your document connect"
    : hasMap ? `${concepts.length} concepts${map.scope.kind === "course" ? ` across ${map.built} of ${map.total} documents` : ""} · coloured by how well you know them`
      : map.scope.name;
  const toolbar = (
    <StudyToolbar title="Concept map" subtitle={subtitle}>
      {hasMap && (
        <>
          <Button size="sm" pressed={view === "graph"} onClick={() => setView("graph")} aria-label="Show as a map" title="Map" className="min-w-11">
            <Network size={15} aria-hidden="true" /><span className="max-sm:hidden">Map</span>
          </Button>
          <Button size="sm" pressed={view === "list"} onClick={() => setView("list")} aria-label="Show as a list" title="List" className="min-w-11">
            <List size={15} aria-hidden="true" /><span className="max-sm:hidden">List</span>
          </Button>
        </>
      )}
      {hasMap && canBuild && (
        <Button size="sm" onClick={() => void build()} loading={starting} title="Map the documents that have no map yet">
          <RefreshCw size={14} aria-hidden="true" />Finish the map
        </Button>
      )}
    </StudyToolbar>
  );
  const frame = (body: React.ReactNode) => (
    <div className="ws-pane flex flex-col h-full overflow-hidden">
      {toolbar}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6" tabIndex={0} role="region" aria-label="Concept map">
        <div className="mx-auto w-full max-w-[1180px]">{body}</div>
      </div>
    </div>
  );

  if (!documentId) {
    return frame(<EmptyState icon={<Network size={30} />} title="No document yet" description="Upload a PDF: its concept map shows how its ideas connect." />);
  }
  if (phase === "loading") return frame(<Skeleton className="h-[420px] w-full rounded-[var(--radius-xl)]" aria-label="Loading the concept map" />);
  if (phase === "locked") {
    return frame(
      <UpgradeCard feature="The concept map" plan={plan}
        description="Every concept in your PDFs and how they connect, as a mind map coloured by how well you know each one. One click starts a quiz, flashcards or a boss fight on any of them.">
        <ButtonLink size="sm" href={ROUTES.studyTab("quiz", undefined, documentId)}><Brain size={15} aria-hidden="true" />Take a quiz</ButtonLink>
      </UpgradeCard>,
    );
  }
  if (phase === "error" || !map) {
    return frame(<EmptyState icon={<Network size={30} />} title="The concept map didn't load"
      action={<Button variant="primary" onClick={() => void load()}>Try again</Button>} />);
  }
  if (map.status === "not_ready") {
    return frame(<EmptyState icon={<Network size={30} />} title="Still reading your document"
      description="The concept map can be made once indexing has finished." />);
  }
  if (building && !hasMap) return frame(<Progress map={map} />);
  if (!hasMap) {
    const failed = map.status === "failed";
    return frame(
      <EmptyState icon={<Sparkles size={30} />}
        title={failed ? "The concept map couldn't be made" : "Map the concepts in this " + (map.scope.kind === "course" ? "course" : "document")}
        description={failed
          ? map.documents.find((d) => d.error)?.error ?? "Try again."
          : "One AI pass per document finds its key concepts and how they connect. It's made once and kept, so opening it again costs nothing."}
        action={<Button variant="primary" loading={starting} onClick={() => void build()}><Sparkles size={16} aria-hidden="true" />{failed ? "Try again" : "Make the concept map"}</Button>} />,
    );
  }

  const panel = concept && (
    <ConceptPanel concept={concept} scopeId={documentId} docNames={docNames} concepts={concepts}
      linked={neighbours(concept.id, map.relations)} onPick={setSelected} onClose={() => setSelected(null)} />
  );
  return frame(
    <>
      {building && <p className="cmap-notice" role="status">{map.stage ?? "Mapping the other documents…"} ({map.built} of {map.total} done)</p>}
      {map.status === "partial" && <p className="cmap-notice">Some documents aren't mapped yet. "Finish the map" adds them.</p>}
      <div className="cmap-wrap" data-panel={panel ? undefined : "none"}>
        <div>
          {view === "graph" ? (
            <MindMap subject={map.scope.name.replace(/\.pdf$/i, "")} concepts={concepts} relations={map.relations} selected={selected} onSelect={setSelected} />
          ) : (
            <ConceptList concepts={concepts} relations={map.relations} selected={selected} onSelect={setSelected} />
          )}
          <Legend />
        </div>
        {panel}
      </div>
    </>,
  );
}

function Progress({ map }: { map: ConceptMap }) {
  const share = map.total ? Math.max(0.08, map.built / map.total) : 0.08;
  return (
    <section className="cmap-progress" aria-labelledby="cmap-progress-title" aria-busy="true">
      <h3 id="cmap-progress-title" className="m-0 text-base font-semibold">Making the concept map</h3>
      <p className="m-0 text-sm text-fg-2" role="status" aria-live="polite">{map.stage ?? "Waiting to start…"}</p>
      <div className="cmap-progress__bar" role="progressbar" aria-label="Documents mapped" aria-valuemin={0}
           aria-valuemax={map.total} aria-valuenow={map.built}><span style={{ width: `${share * 100}%` }} /></div>
      {map.total > 1 && (
        <ul>{map.documents.filter((d) => d.status !== "not_ready").map((d) => (
          <li key={d.id}><span className="truncate">{d.name}</span><span>{d.status === "ready" ? "Done" : d.status === "failed" ? "Failed" : d.status === "running" ? "Mapping…" : "Waiting"}</span></li>
        ))}</ul>
      )}
      <p className="m-0 text-xs text-fg-muted">This takes a minute or two. You can keep studying; the map is kept once it's made.</p>
    </section>
  );
}

function Legend() {
  return (
    <ul className="cmap-legend" aria-label="Legend">
      {HEATS.map((h) => (
        <li key={h}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="mm__node" data-heat={h}>
            <circle className="mm__dot" cx="7" cy="7" r="5" />
          </svg>
          {heatLabel(h)}
        </li>
      ))}
      <li>Each colour is one main idea · hover a concept to see its links</li>
    </ul>
  );
}

function ConceptList({ concepts, relations, selected, onSelect }: {
  concepts: MapConcept[]; relations: ConceptMap["relations"]; selected: string | null; onSelect: (id: string | null) => void;
}) {
  return (
    <div className="cmap-list">
      {IMPORTANCE.map(({ n, label }) => {
        const group = concepts.filter((c) => (c.importance || 2) === n);
        if (!group.length) return null;
        return (
          <section key={n} aria-labelledby={`cmap-list-${n}`}>
            <h3 id={`cmap-list-${n}`}>{label}</h3>
            <ul>
              {group.map((c) => {
                const links = neighbours(c.id, relations).length;
                return (
                  <li key={c.id}>
                    <button type="button" className="cmap-item" aria-pressed={selected === c.id}
                            onClick={() => onSelect(selected === c.id ? null : c.id)}>
                      <span className="cmap-item__name">{c.name}</span>
                      <span className="cmap-item__meta">{links} {links === 1 ? "link" : "links"}</span>
                      <Badge tone={HEAT_TONE[c.heat]}>{heatLabel(c.heat)}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ConceptPanel({ concept, scopeId, docNames, concepts, linked, onPick, onClose }: {
  concept: MapConcept; scopeId: string; docNames: Map<string, string>; concepts: MapConcept[]; linked: string[];
  onPick: (id: string) => void; onClose: () => void;
}) {
  const names = new Map(concepts.map((c) => [c.id, c.name]));
  const pages = concept.pages.slice(0, 4).map((p) => `${docNames.size > 1 ? `${docNames.get(p.doc_id) ?? "PDF"} · ` : ""}p.${p.page}`);
  return (
    <section className="cmap-panel" aria-labelledby="cmap-panel-title">
      <div className="cmap-panel__head">
        <div className="grid gap-1 min-w-0">
          <h3 id="cmap-panel-title">{concept.name}</h3>
          <span><Badge tone={HEAT_TONE[concept.heat]}>{heatLabel(concept.heat)}</Badge></span>
        </div>
        <Button size="sm" icon variant="ghost" onClick={onClose} aria-label="Close the concept"><X size={16} /></Button>
      </div>
      {concept.summary && <p>{concept.summary}</p>}
      <p className="cmap-panel__meta">
        {concept.seen ? `${concept.correct} of ${concept.seen} answers right` : "Not asked yet"}
        {pages.length ? ` · explained on ${pages.join(", ")}` : ""}
      </p>
      {linked.length > 0 && (
        <div>
          <h4>Linked to</h4>
          <ul className="cmap-panel__links">
            {linked.map((id) => (
              <li key={id}><Button size="sm" variant="ghost" onClick={() => onPick(id)}>{names.get(id) ?? id}</Button></li>
            ))}
          </ul>
        </div>
      )}
      <div className="cmap-panel__actions">
        <ButtonLink size="sm" variant="primary" href={ROUTES.studyTopic("quiz", scopeId, concept.name)}><Brain size={15} aria-hidden="true" />Quick quiz on it</ButtonLink>
        <ButtonLink size="sm" href={ROUTES.studyTopic("flashcards", scopeId, concept.name)}><Layers size={15} aria-hidden="true" />Flashcards</ButtonLink>
        <ButtonLink size="sm" href={ROUTES.heroArenaTopic(scopeId, concept.name)}><Swords size={15} aria-hidden="true" />Summon its boss</ButtonLink>
      </div>
    </section>
  );
}
