"use client";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, RefreshCw, Sparkles, FileText, Zap, Brain, NotebookPen } from "lucide-react";
import HistoryPanel from "./HistoryPanel";
import StudyToolbar from "./study/StudyToolbar";
import { Button, Input, Select, Tabs } from "@/components/ui";
import { generateNotes } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";
import { saveSessionData, loadSessionData } from "@/lib/sessions";
import { toast } from "@/components/ui/Toast";

const TOPIC_SUGGESTIONS = [
  { label: "Key Concepts",  icon: <Brain size={16} />,    topic: "key concepts and main ideas" },
  { label: "Summary",       icon: <Sparkles size={16} />, topic: "complete summary" },
  { label: "Definitions",   icon: <FileText size={16} />, topic: "important definitions and terminology" },
  { label: "Examples",      icon: <Zap size={16} />,      topic: "examples and case studies" },
];

interface SavedNotes { notes: string; topic: string; detail: string; }

/** `documentId` is the workspace's active document (what the notes are about); `historyId` is just this saved set of notes. */
export default function NotesView({ documentId, restoreSessionId }: { documentId?: string; restoreSessionId?: string }) {
  const [historyId, setHistoryId] = useState(() => restoreSessionId || crypto.randomUUID());
  const sessionId = documentId ?? historyId;
  const refreshIfStale = useHUDStore((s) => s.refreshIfStale);
  const [topic, setTopic] = useState("");
  const [detail, setDetail] = useState("Normal (Simplified)");
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [tab, setTab] = useState<"full" | "outline">("full");
  const [showHistory, setShowHistory] = useState(false);
  const notesContentRef = useRef<HTMLDivElement>(null);
  const notesScrollRef = useRef<HTMLDivElement>(null);   // the scrolling box the outline jumps within

  // Restore from history navigation
  useEffect(() => {
    if (restoreSessionId) loadHistorySession(restoreSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async (customTopic?: string) => {
    const finalTopic = customTopic || topic;
    if (!finalTopic.trim()) { toast.error("Please enter a topic"); return; }
    setLoading(true);
    let data: Awaited<ReturnType<typeof generateNotes>> | undefined;
    try {
      // Use existing sessionId so the PDF uploaded to this session is found on the backend
      data = await generateNotes(finalTopic, detail, sessionId);
    } catch (e) {
      setLoading(false);
      toast.apiError(e, { onRetry: () => handleGenerate(finalTopic) });
      return;
    }
    setLoading(false);
    if (data?.content) {
      setNotes(data.content);
      setTopic(finalTopic);
      // Save to history
      const preview = `${finalTopic} · ${detail}`;
      saveSessionData(historyId, "notes", preview, { notes: data.content, topic: finalTopic, detail } as SavedNotes, finalTopic);
      if (data.rewards?.ok) {
        toast.success(`+${data.rewards.xp_gained} XP | +${data.rewards.coins_gained} Coins`, { icon: "🎉" });
        refreshIfStale(5_000);
      }
    } else {
      toast.error("Notes generation failed. Make sure a PDF is uploaded.");
    }
  };

  const loadHistorySession = (id: string) => {
    const data = loadSessionData<SavedNotes>(id);
    if (!data?.notes) return;
    setHistoryId(id);
    setNotes(data.notes);
    setTopic(data.topic || "");
    setDetail(data.detail || "Normal (Simplified)");
    setTab("full");
    setShowHistory(false);
  };

  const handleNew = () => {
    setNotes(null);
    setTopic("");
    // Do NOT reset sessionId — PDF stays uploaded to this session
  };

  const wordCount = notes ? notes.split(/\s+/).length : 0;
  const readingTime = Math.max(1, Math.floor(wordCount / 200));
  const sections = notes ? notes.split("\n").filter((l) => l.startsWith("##")).length : 0;

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
          subtitle={notes ? topic : "Study notes from your document"}
          historyLabel="Notes history" historyOpen={showHistory} onToggleHistory={() => setShowHistory((v) => !v)}
          onNew={notes ? handleNew : undefined} newLabel="New notes"
        />

        {!notes ? (
          /* ── SETUP ── */
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-10">
            <div className="mx-auto w-full max-w-[72ch]">
              <div className="study-intro">
                <span className="study-intro__icon" aria-hidden="true"><NotebookPen size={26} /></span>
                <div>
                  <h3>Generate study notes</h3>
                  <p>Pick a topic from your document and get notes you can read, outline and download.</p>
                </div>
              </div>

              <form className="study-card space-y-5 mb-8" onSubmit={(e) => { e.preventDefault(); void handleGenerate(); }}>
                <Input label="What would you like notes on?" value={topic} onChange={(e) => setTopic(e.target.value)}
                       placeholder="e.g. Machine learning basics, Chapter 3 summary, Key definitions" />
                <Select label="Detail level" value={detail} onChange={(e) => setDetail(e.target.value)}>
                  <option>Normal (Simplified)</option>
                  <option>Ultra-detailed (Exam Ready)</option>
                </Select>
                <Button type="submit" variant="primary" block loading={loading} disabled={!topic.trim()}>
                  {loading ? "Generating notes…" : <><Sparkles size={16} aria-hidden="true" />Generate notes</>}
                </Button>
              </form>

              <div>
                <p className="study-suggest-label">Or start with one of these:</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {TOPIC_SUGGESTIONS.map((s) => (
                    <button type="button" key={s.label} disabled={loading} onClick={() => void handleGenerate(s.topic)} className="study-prompt">
                      <span className="text-ink-blue" aria-hidden="true">{s.icon}</span>{s.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="mt-8 text-sm text-fg-muted">Be specific about the topic for better notes. Use “Ultra-detailed” for exam preparation. Past notes are saved: open History to revisit them.</p>
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
              <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(notes)}`} download={`${topic || "notes"}.md`}
                 className="inline-flex items-center gap-1 text-ink-blue hover:underline">
                <Download size={12} aria-hidden="true" /> Markdown
              </a>
              <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(notes.replace(/[#*`]/g, ""))}`} download={`${topic || "notes"}.txt`}
                 className="inline-flex items-center gap-1 text-ink-blue hover:underline">
                <Download size={12} aria-hidden="true" /> Text
              </a>
              <Button size="sm" variant="ghost" onClick={handleNew}><RefreshCw size={12} aria-hidden="true" />New</Button>
            </div>

            <div className="shrink-0 px-6 pt-3">
              <Tabs label="Notes view" value={tab} onChange={(id) => setTab(id as "full" | "outline")}
                    tabs={[{ id: "full", label: "Full notes" }, { id: "outline", label: "Outline" }]} />
            </div>

            <div ref={notesScrollRef} className="relative flex-1 min-h-0 overflow-y-auto notes-scroll px-6 py-6">
              {tab === "full" && (
                <div ref={notesContentRef} className="notes-canvas mx-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
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
    </div>
  );
}
