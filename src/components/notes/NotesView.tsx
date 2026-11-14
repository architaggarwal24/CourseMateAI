"use client";

import DeskObject from "@/components/study/DeskObject";
import { rewardText } from "@/lib/game/reward-text";
import AiLabel from "@/components/study/AiLabel";
import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Download, RefreshCw, Sparkles, FileText, Zap, Brain, TableCells, List, KeyRound, ScrollText, Printer, Copy } from "@/components/ui/icons";
import HistoryPanel from "../history/HistoryPanel";
import StudyToolbar from "../study/StudyToolbar";
import Writing from "../study/Writing";
import ChatMarkdown from "../chat/ChatMarkdown";
import CitationList from "../chat/CitationList";
import { Button, Input, Tabs } from "@/components/ui";
import { generateNotes } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";
import { saveSessionData, loadSessionData } from "@/lib/study/sessions";
import { forgetSession, rememberSession, useDraft } from "@/lib/study/memory";
import { NothingMade, clearJob, jobErrorToast, startJob, useJob } from "@/lib/study/background";
import { citedFirst, citationText, type Citation } from "@/lib/study/citations";
import { toast } from "@/components/ui/Toast";

const PdfViewer = dynamic(() => import("../pdf/PdfViewer"), { ssr: false });

/** The note formats (server: study/prompts.ts NOTE_FORMATS). */
export const NOTE_FORMATS: { id: string; label: string; hint: string; icon: ReactNode }[] = [
  { id: "summary",    label: "Summary",     hint: "The main ideas, short and clear",            icon: <Sparkles size={18} /> },
  { id: "detailed",   label: "Exam-ready",  hint: "Everything in depth, with examples",         icon: <Brain size={18} /> },
  { id: "cornell",    label: "Cornell",     hint: "Cue questions beside notes, then a summary", icon: <TableCells size={18} /> },
  { id: "outline",    label: "Outline",     hint: "A nested outline of the topic",              icon: <List size={18} /> },
  { id: "keyterms",   label: "Key terms",   hint: "A glossary: term, meaning, example",         icon: <KeyRound size={18} /> },
  { id: "cheatsheet", label: "Cheat sheet", hint: "One page of facts, formulas and traps",      icon: <ScrollText size={18} /> },
];
const formatLabel = (id: string) => NOTE_FORMATS.find((f) => f.id === id)?.label ?? "Notes";

const TOPIC_SUGGESTIONS = [
  { label: "Key Concepts",  icon: <Brain size={16} />,    topic: "key concepts and main ideas" },
  { label: "Summary",       icon: <Sparkles size={16} />, topic: "complete summary" },
  { label: "Definitions",   icon: <FileText size={16} />, topic: "important definitions and terminology" },
  { label: "Examples",      icon: <Zap size={16} />,      topic: "examples and case studies" },
];

/** Saved notes. `detail` is from before round 7 (the old detail level) and still opens. */
interface SavedNotes { notes: string; topic: string; format?: string; detail?: string; citations?: Citation[] }
const savedFormat = (s: SavedNotes) =>
  s.format && NOTE_FORMATS.some((f) => f.id === s.format) ? s.format : /Ultra-detailed|Exam Ready/.test(s.detail ?? "") ? "detailed" : "summary";

/** The passages the notes cite, in order of first use (all of them when the notes cite none). */
function notesSources(notes: string, citations: Citation[]): Citation[] {
  const used = new Set([...notes.matchAll(/\[(\d{1,2})\](?!\()/g)].map((m) => Number(m[1])));
  const cited = citedFirst(notes, citations).filter((c) => used.has(c.n));
  return cited.length ? cited : citations;
}

/** The notes as a Markdown file: the [n] markers stay, and a Sources list at the end says which page each one is. */
export function notesMarkdown(notes: string, citations: Citation[]): string {
  const used = [...notesSources(notes, citations)].sort((a, b) => a.n - b.n);
  if (!used.length) return notes;
  return `${notes.trimEnd()}\n\n## Sources\n\n${used.map((c) => `- [${c.n}] ${c.label || citationText(c)}`).join("\n")}\n`;
}

/** `documentId` is the workspace's active document (what the notes are about); `historyId` is just this saved set of notes. */
export default function NotesView({ documentId, restoreSessionId }: { documentId?: string; restoreSessionId?: string }) {
  const [historyId, setHistoryId] = useState(() => restoreSessionId || crypto.randomUUID());
  const sessionId = documentId ?? historyId;
  const refreshIfStale = useHUDStore((s) => s.refreshIfStale);
  const [topic, setTopic] = useDraft("notes", documentId);         // typed but not sent: kept (lib/study/memory.ts)
  const [format, setFormat] = useState("summary");
  const [notes, setNotes] = useState<string | null>(null);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [tab, setTab] = useState<"full" | "outline">("full");
  const [showHistory, setShowHistory] = useState(false);
  const notesContentRef = useRef<HTMLDivElement>(null);
  const notesScrollRef = useRef<HTMLDivElement>(null);   // the scrolling box the outline jumps within

  // the passage open in the PDF viewer (focus goes back to the [n] that opened it)
  const [openCitation, setOpenCitationState] = useState<Citation | null>(null);
  const citeOpener = useRef<HTMLElement | null>(null);
  const setOpenCitation = useCallback((c: Citation | null) => {
    if (c) citeOpener.current = document.activeElement as HTMLElement | null;
    setOpenCitationState(c);
  }, []);
  const closeCitation = useCallback(() => {
    setOpenCitationState(null);
    requestAnimationFrame(() => citeOpener.current?.focus?.({ preventScroll: true }));
  }, []);

  // Restore from history navigation
  useEffect(() => {
    if (restoreSessionId) loadHistorySession(restoreSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Writing notes carries on when you leave this screen (lib/study/background.ts): the job saves them to History and
  // remembers them as this tool's open notes; this view shows them when it finishes (now, or when you come back).
  const job = useJob("notes", documentId);
  const loading = job?.status === "running";
  const handleGenerate = async (customTopic?: string) => {
    const finalTopic = customTopic || topic;
    if (!finalTopic.trim()) { toast.error("Please enter a topic"); return; }
    const id = historyId, scope = documentId, fmt = format;
    startJob("notes", scope, finalTopic, async () => {
      // Use existing sessionId so the PDF uploaded to this session is found on the backend
      const data = await generateNotes(finalTopic, fmt, sessionId);
      if (typeof data?.content !== "string" || !data.content) throw new NothingMade("Notes generation failed. Make sure a PDF is uploaded.");
      const cites = Array.isArray(data.citations) ? data.citations : [];
      saveSessionData(id, "notes", `${finalTopic} · ${formatLabel(fmt)}`,
        { notes: data.content, topic: finalTopic, format: fmt, citations: cites } as SavedNotes, finalTopic);
      rememberSession("notes", scope, id);                 // these notes reopen here next time
      if (data.rewards?.ok) {
        toast.success(rewardText(data.rewards.xp_gained, data.rewards.coins_gained));
        refreshIfStale(5_000);
      }
      return id;
    }, {
      onError: (e) => jobErrorToast(e, toast, () => handleGenerate(finalTopic)),
      ready: (label) => toast.success(`Your notes on “${label}” are ready. Open Notes to read them.`),
      meta: `${formatLabel(fmt).toLowerCase()} notes`,
    });
  };
  // a finished job (started here, or before you left and came back): show its notes
  useEffect(() => {
    if (job?.status === "done" && job.sessionId) { loadHistorySession(job.sessionId); clearJob("notes", documentId); }
    else if (job?.status === "failed") clearJob("notes", documentId);
  }, [job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHistorySession = (id: string) => {
    const data = loadSessionData<SavedNotes>(id);
    if (!data?.notes) return;
    setHistoryId(id);
    rememberSession("notes", documentId, id);
    setNotes(data.notes);
    setCitations(Array.isArray(data.citations) ? data.citations : []);
    setTopic(data.topic || "");
    setFormat(savedFormat(data));
    setTab("full");
    setShowHistory(false);
  };

  const handleNew = () => {
    setNotes(null);
    setCitations([]);
    setTopic("");
    forgetSession("notes", documentId);
    setHistoryId(crypto.randomUUID());                    // the next notes are a new History entry, not these overwritten
  };

  const copyNotes = async () => {
    if (!notes) return;
    const copied = await navigator.clipboard?.writeText(notesMarkdown(notes, citations)).then(() => true, () => false);
    if (copied) toast.success("Notes copied");
    else toast.info("Couldn't copy here. Select the text and copy it instead.");
  };

  const wordCount = notes ? notes.split(/\s+/).length : 0;
  const readingTime = Math.max(1, Math.floor(wordCount / 200));
  const sections = notes ? notes.split("\n").filter((l) => l.startsWith("##")).length : 0;
  const sources = useMemo(() => (notes ? notesSources(notes, citations) : []), [notes, citations]);
  const markdownFile = notes ? notesMarkdown(notes, citations) : "";
  const fileName = topic || "notes";

  const headers = notes
    ? notes.split("\n").filter((line) => line.startsWith("#")).map((line) => {
        const level = line.length - line.replace(/^#+/, "").length;
        const text = line.replace(/^#+\s*/, "");
        return { text, level };
      })
    : [];

  const scrollToSection = (headerText: string) => {
    setTab("full");
    setTimeout(() => {
      if (!notesContentRef.current || !notesScrollRef.current) return;
      const headings = notesContentRef.current.querySelectorAll("h1, h2, h3, h4, h5, h6");
      for (const heading of headings) {
        if (heading.textContent?.trim() === headerText.trim()) {
          const container = notesScrollRef.current;
          const headingTop = (heading as HTMLElement).offsetTop;
          container.scrollTo({ top: headingTop - 24, behavior: "smooth" });
          break;
        }
      }
    }, 120);
  };

  return (
    <div className="flex h-full overflow-hidden">
      {showHistory && (
        <HistoryPanel
          activeMode="notes"
          onSelect={(id) => loadHistorySession(id)}
          onNew={() => { handleNew(); setShowHistory(false); }}
          onClose={() => setShowHistory(false)}
        />
      )}

      <div className="ws-pane flex flex-col flex-1 min-w-0 overflow-hidden">
        <StudyToolbar
          title="Notes"
          subtitle={notes ? `${topic} · ${formatLabel(format)}` : "Study notes from your document"}
          historyLabel="Notes history" historyOpen={showHistory} onToggleHistory={() => setShowHistory((v) => !v)}
          onNew={notes ? handleNew : undefined} newLabel="New notes"
        />

        {!notes ? (
          /* ── SETUP ── */
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-10">
            <div className="mx-auto w-full max-w-[72ch]">
              <div className="study-intro">
                <DeskObject kind="notes" />
                <div>
                  <h3>Write study notes</h3>
                  <p>Pick a topic and a format. Every fact links back to the page it came from.</p>
                </div>
              </div>

              {loading && job && (
                <Writing what={job.meta ?? "notes"} topic={job.label} startedAt={job.startedAt}
                  steps={["Finding the passages about it in your PDFs…", "Reading them closely…", "Writing the notes…", "Adding page links to every fact…", "Almost done…"]} />
              )}
              <form hidden={loading} className="study-card space-y-5 mb-8" onSubmit={(e) => { e.preventDefault(); void handleGenerate(); }}>
                <Input label="What would you like notes on?" value={topic} onChange={(e) => setTopic(e.target.value)}
                       placeholder="e.g. Machine learning basics, Chapter 3 summary, Key definitions" />
                <fieldset className="note-formats">
                  <legend className="note-formats__legend">Format</legend>
                  <div className="note-formats__grid">
                    {NOTE_FORMATS.map((f) => (
                      <label key={f.id} className="note-format">
                        <input type="radio" name="note-format" value={f.id} checked={format === f.id} onChange={() => setFormat(f.id)} className="sr-only" />
                        <span className="note-format__icon" aria-hidden="true">{f.icon}</span>
                        <span className="note-format__text">
                          <span className="note-format__name">{f.label}</span>
                          <span className="note-format__hint">{f.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Button type="submit" variant="primary" block loading={loading} disabled={!topic.trim()}>
                  {loading ? "Generating notes…" : <><Sparkles size={16} aria-hidden="true" />Generate notes</>}
                </Button>
              </form>
              <div hidden={loading}>
                <p className="study-suggest-label">Or start with one of these:</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {TOPIC_SUGGESTIONS.map((s) => (
                    <button type="button" key={s.label} disabled={loading} onClick={() => void handleGenerate(s.topic)} className="study-prompt">
                      <span className="text-ink-blue" aria-hidden="true">{s.icon}</span>{s.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="mt-8 text-sm text-fg-muted">Be specific about the topic for better notes. Use “Exam-ready” before a test, “Cheat sheet” the night before. Past notes are saved: open History to revisit them.</p>
            </div>
          </div>
        ) : (
          /* ── NOTES ── */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="ws-bar">
              <span>{wordCount.toLocaleString()} words</span>
              <span>~{readingTime} min read</span>
              <span>{sections} {sections === 1 ? "section" : "sections"}</span>
              <span className="flex-1" />
              <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(markdownFile)}`} download={`${fileName}.md`}
                 className="notes-action">
                <Download size={12} aria-hidden="true" /> Markdown
              </a>
              <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(markdownFile.replace(/[#*`]/g, ""))}`} download={`${fileName}.txt`}
                 className="notes-action">
                <Download size={12} aria-hidden="true" /> Text
              </a>
              <button type="button" className="notes-action" onClick={() => window.print()}>
                <Printer size={12} aria-hidden="true" /> Print / PDF
              </button>
              <button type="button" className="notes-action" onClick={() => void copyNotes()}>
                <Copy size={12} aria-hidden="true" /> Copy
              </button>
              <Button size="sm" variant="ghost" onClick={handleNew}><RefreshCw size={12} aria-hidden="true" />New</Button>
            </div>

            <div className="shrink-0 px-6 pt-3">
              <Tabs label="Notes view" value={tab} onChange={(id) => setTab(id as "full" | "outline")}
                    tabs={[{ id: "full", label: "Full notes" }, { id: "outline", label: "Outline" }]} />
            </div>

            <div ref={notesScrollRef} className="relative flex-1 min-h-0 overflow-y-auto notes-scroll px-6 py-6">
              {tab === "full" && (
                <div ref={notesContentRef} className="notes-canvas mx-auto" data-print="notes">
                  <ChatMarkdown citations={citations.length}
                    onCite={citations.length ? (n) => setOpenCitation(citations.find((c) => c.n === n) ?? null) : undefined}>
                    {notes}
                  </ChatMarkdown>
                  <AiLabel what="notes" />
                  {sources.length > 0 && (
                    <section className="notes-sources" aria-labelledby="notes-sources-h">
                      <h2 id="notes-sources-h" className="notes-sources__title">Sources</h2>
                      <CitationList citations={sources} onOpen={setOpenCitation} />
                    </section>
                  )}
                </div>
              )}
              {tab === "outline" && (
                <nav aria-label="Outline" className="mx-auto w-full max-w-[72ch] space-y-1">
                  {headers.length > 0 ? headers.map((h, i) => (
                    <button key={i} type="button" onClick={() => scrollToSection(h.text)}
                      style={{ paddingLeft: `${(h.level - 1) * 20 + 12}px` }}
                      className={`notes-outline__item text-sm ${h.level === 1 ? "mt-3 text-base font-semibold text-fg" : h.level === 2 ? "font-medium text-fg-2" : "text-fg-muted"}`}>
                      {h.text}
                    </button>
                  )) : (
                    <p className="py-8 text-center text-sm text-fg-muted">No structured outline detected.</p>
                  )}
                </nav>
              )}
            </div>
          </div>
        )}
      </div>
      {openCitation && <PdfViewer citation={openCitation} onClose={closeCitation} />}
    </div>
  );
}
