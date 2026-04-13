// "use client";
// import { useState, useRef } from "react";
// import ReactMarkdown from "react-markdown";
// import remarkGfm from "remark-gfm";
// import { Loader2, Download, RefreshCw, BookOpen, Sparkles, FileText, Zap, Brain, History, Plus } from "lucide-react";
// import FileUploader from "./FileUploader";
// import HistoryPanel from "./HistoryPanel";
// import { generateNotes } from "@/lib/api";
// import { useHUDStore } from "@/hooks/useHUD";
// import { saveSessionData, loadSessionData } from "@/lib/sessions";
// import { toast } from "sonner";

// const TOPIC_SUGGESTIONS = [
//   { label: "Key Concepts",  icon: <Brain size={16} />,    topic: "key concepts and main ideas" },
//   { label: "Summary",       icon: <Sparkles size={16} />, topic: "complete summary" },
//   { label: "Definitions",   icon: <FileText size={16} />, topic: "important definitions and terminology" },
//   { label: "Examples",      icon: <Zap size={16} />,      topic: "examples and case studies" },
// ];

// interface SavedNotes { notes: string; topic: string; detail: string; }

// export default function NotesView() {
//   const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
//   const { refresh, refreshIfStale } = useHUDStore((s) => ({ refresh: s.refresh, refreshIfStale: s.refreshIfStale }));
//   const [topic, setTopic] = useState("");
//   const [detail, setDetail] = useState("Normal (Simplified)");
//   const [loading, setLoading] = useState(false);
//   const [notes, setNotes] = useState<string | null>(null);
//   const [tab, setTab] = useState<"full" | "outline">("full");
//   const [showHistory, setShowHistory] = useState(false);
//   const notesContentRef = useRef<HTMLDivElement>(null);

//   const handleGenerate = async (customTopic?: string) => {
//     const finalTopic = customTopic || topic;
//     if (!finalTopic.trim()) { toast.error("Please enter a topic"); return; }
//     setLoading(true);
//     // Use existing sessionId so the PDF uploaded to this session is found on the backend
//     const data = await generateNotes(finalTopic, detail, sessionId);
//     setLoading(false);
//     if (data?.content) {
//       setNotes(data.content);
//       setTopic(finalTopic);
//       // Save to history
//       const preview = `${finalTopic} · ${detail}`;
//       saveSessionData(sessionId, "notes", preview, { notes: data.content, topic: finalTopic, detail } as SavedNotes, finalTopic);
//       if (data.rewards?.ok) {
//         toast.success(`+${data.rewards.xp_gained} XP | +${data.rewards.coins_gained} Coins`, { icon: "🎉" });
//         refreshIfStale(5_000);
//       }
//     } else {
//       toast.error("Notes generation failed. Make sure a PDF is uploaded.");
//     }
//   };

//   const loadHistorySession = (id: string) => {
//     const data = loadSessionData<SavedNotes>(id);
//     if (!data?.notes) return;
//     setSessionId(id);
//     setNotes(data.notes);
//     setTopic(data.topic || "");
//     setDetail(data.detail || "Normal (Simplified)");
//     setTab("full");
//     setShowHistory(false);
//   };

//   const handleNew = () => {
//     setNotes(null);
//     setTopic("");
//     // Do NOT reset sessionId — PDF stays uploaded to this session
//   };

//   const wordCount = notes ? notes.split(/\s+/).length : 0;
//   const readingTime = Math.max(1, Math.floor(wordCount / 200));
//   const sections = notes ? notes.split("\n").filter((l) => l.startsWith("##")).length : 0;

//   const headers = notes
//     ? notes.split("\n").filter((line) => line.startsWith("#")).map((line) => {
//         const level = line.length - line.replace(/^#+/, "").length;
//         const text = line.replace(/^#+\s*/, "");
//         return { text, level };
//       })
//     : [];

//   const scrollToSection = (headerText: string) => {
//     setTab("full");
//     setTimeout(() => {
//       if (!notesContentRef.current) return;
//       const headings = notesContentRef.current.querySelectorAll("h1, h2, h3, h4, h5, h6");
//       for (const heading of headings) {
//         if (heading.textContent?.trim() === headerText.trim()) {
//           heading.scrollIntoView({ behavior: "smooth", block: "start" });
//           break;
//         }
//       }
//     }, 100);
//   };

//   return (
//     <div className="flex h-full overflow-hidden">
//       {showHistory && (
//         <HistoryPanel
//           activeMode="notes"
//           onSelect={(id) => loadHistorySession(id)}
//           onNew={() => { handleNew(); setShowHistory(false); }}
//           onClose={() => setShowHistory(false)}
//         />
//       )}

//       <div className="flex flex-col flex-1 overflow-hidden bg-bg-primary">
//         {/* Header */}
//         <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm">
//           <div className="flex items-center gap-3">
//             <div className="p-2 rounded-lg bg-accent-purple/10 border border-accent-purple/20">
//               <BookOpen size={18} className="text-accent-purple" />
//             </div>
//             <div>
//               <h2 className="text-lg font-semibold text-text-primary">Smart Notes</h2>
//               <p className="text-xs text-text-muted">
//                 {notes ? `${topic} · ${wordCount.toLocaleString()} words` : "AI-powered study notes from your documents"}
//               </p>
//             </div>
//           </div>
//           <div className="flex items-center gap-2">
//             <button
//               onClick={() => setShowHistory((v) => !v)}
//               className={`p-2 rounded-lg border transition-all ${showHistory ? "border-accent-purple text-accent-purple bg-accent-purple/10" : "border-border text-text-muted hover:border-accent-purple/50 hover:text-accent-purple"}`}
//               title="Notes history"
//             ><History size={16} /></button>
//             {notes && (
//               <button onClick={handleNew} className="p-2 rounded-lg border border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold transition-all" title="New notes">
//                 <Plus size={16} />
//               </button>
//             )}
//             <FileUploader sessionId={sessionId} />
//           </div>
//         </div>

//         {!notes ? (
//           /* ── EMPTY STATE ── */
//           <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 overflow-y-auto notes-scroll">
//             <div className="w-full max-w-2xl">
//               <div className="text-center mb-8">
//                 <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-accent-purple/10 border border-accent-purple/20 mb-4">
//                   <BookOpen size={40} className="text-accent-purple" />
//                 </div>
//                 <h3 className="text-2xl font-bold text-text-primary mb-2">Generate Study Notes</h3>
//                 <p className="text-text-muted text-sm max-w-md mx-auto">
//                   Upload a PDF and create comprehensive notes on any topic. Perfect for exam prep and quick reviews.
//                 </p>
//               </div>

//               <div className="space-y-4 mb-6">
//                 <div>
//                   <label className="block text-sm font-medium text-text-muted mb-2">What would you like notes on?</label>
//                   <input
//                     className="w-full bg-bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-purple focus:ring-2 focus:ring-accent-purple/20 transition-all"
//                     placeholder="e.g., Machine Learning Basics, Chapter 3 Summary, Key Definitions..."
//                     value={topic} onChange={(e) => setTopic(e.target.value)}
//                     onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
//                   />
//                 </div>
//                 <div>
//                   <label className="block text-sm font-medium text-text-muted mb-2">Detail Level</label>
//                   <select
//                     className="w-full bg-bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-purple focus:ring-2 focus:ring-accent-purple/20 transition-all"
//                     value={detail} onChange={(e) => setDetail(e.target.value)}
//                   >
//                     <option>Normal (Simplified)</option>
//                     <option>Ultra-detailed (Exam Ready)</option>
//                   </select>
//                 </div>
//                 <button
//                   onClick={() => handleGenerate()} disabled={loading || !topic.trim()}
//                   className="w-full py-3 rounded-xl bg-gradient-to-r from-accent-purple to-accent-blue text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-accent-purple/20 flex items-center justify-center gap-2"
//                 >
//                   {loading ? (
//                     <span className="flex items-center gap-2">
//                       <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" />
//                       <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" style={{animationDelay:'0.2s'}} />
//                       <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" style={{animationDelay:'0.4s'}} />
//                       Generating Notes...
//                     </span>
//                   ) : <><Sparkles size={18} />Generate Notes</>}
//                 </button>
//               </div>

//               <div>
//                 <p className="text-xs text-text-muted text-center mb-3">Or try these quick actions:</p>
//                 <div className="grid grid-cols-2 gap-3">
//                   {TOPIC_SUGGESTIONS.map((s, i) => (
//                     <button key={i} onClick={() => handleGenerate(s.topic)} disabled={loading}
//                       className="flex items-center gap-2 px-4 py-3 rounded-lg bg-bg-card border border-border-subtle hover:border-accent-purple/50 text-text-secondary hover:text-text-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed">
//                       <span className="text-accent-purple">{s.icon}</span>
//                       <span className="text-sm font-medium">{s.label}</span>
//                     </button>
//                   ))}
//                 </div>
//               </div>

//               <div className="mt-8 p-4 bg-accent-purple/5 border border-accent-purple/20 rounded-lg">
//                 <h4 className="text-xs font-semibold text-text-primary mb-2 flex items-center gap-1.5">
//                   <Sparkles size={14} className="text-accent-purple" />Pro Tips
//                 </h4>
//                 <ul className="text-xs text-text-muted space-y-1">
//                   <li>• Be specific about the topic for better notes</li>
//                   <li>• Use "Ultra-detailed" mode for exam preparation</li>
//                   <li>• Past notes are saved — open History to revisit them</li>
//                 </ul>
//               </div>
//             </div>
//           </div>
//         ) : (
//           /* ── NOTES DISPLAY ── */
//           <div className="flex-1 flex flex-col overflow-hidden">
//             {/* Stats bar */}
//             <div className="flex items-center gap-6 px-6 py-3 border-b border-border-subtle bg-bg-secondary/30">
//               <div className="text-xs text-text-muted flex items-center gap-1.5"><FileText size={14} />{wordCount.toLocaleString()} words</div>
//               <div className="text-xs text-text-muted flex items-center gap-1.5">⏱ ~{readingTime} min read</div>
//               <div className="text-xs text-text-muted flex items-center gap-1.5">📄 {sections} sections</div>
//               <div className="flex-1" />
//               <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(notes)}`} download={`${topic || "notes"}.md`}
//                 className="text-xs text-text-muted hover:text-accent-purple flex items-center gap-1 transition-colors">
//                 <Download size={12} /> MD
//               </a>
//               <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(notes.replace(/[#*`]/g, ""))}`} download={`${topic || "notes"}.txt`}
//                 className="text-xs text-text-muted hover:text-accent-purple flex items-center gap-1 transition-colors">
//                 <Download size={12} /> TXT
//               </a>
//               <button onClick={handleNew} className="text-xs text-text-muted hover:text-accent-purple flex items-center gap-1 transition-colors">
//                 <RefreshCw size={12} /> New
//               </button>
//             </div>

//             {/* Tabs */}
//             <div className="flex border-b border-border-subtle px-6 bg-bg-secondary/30">
//               {(["full", "outline"] as const).map((t) => (
//                 <button key={t} onClick={() => setTab(t)}
//                   className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${tab === t ? "border-accent-purple text-accent-purple" : "border-transparent text-text-muted hover:text-text-primary"}`}>
//                   {t === "full" ? "📖 Full Notes" : "📑 Outline"}
//                 </button>
//               ))}
//             </div>

//             {/* Content */}
//             <div className="flex-1 overflow-y-auto notes-scroll px-6 py-6">
//               {tab === "full" && (
//                 <div ref={notesContentRef} className="notes-canvas max-w-3xl mx-auto prose prose-invert">
//                   <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
//                 </div>
//               )}
//               {tab === "outline" && (
//                 <div className="max-w-2xl mx-auto space-y-1">
//                   {headers.length > 0 ? headers.map((h, i) => (
//                     <button key={i} onClick={() => scrollToSection(h.text)}
//                       style={{ paddingLeft: `${(h.level - 1) * 20}px` }}
//                       className={`w-full text-left text-sm hover:bg-bg-hover rounded px-3 py-2 transition-colors ${h.level === 1 ? "font-semibold text-text-primary text-base mt-3" : h.level === 2 ? "font-medium text-text-secondary" : "text-text-muted"}`}>
//                       {h.level === 1 ? "📌" : h.level === 2 ? "▸" : "•"} {h.text}
//                     </button>
//                   )) : (
//                     <p className="text-text-muted text-sm italic text-center py-8">No structured outline detected.</p>
//                   )}
//                 </div>
//               )}
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// }





"use client";
import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Download, RefreshCw, BookOpen, Sparkles, FileText, Zap, Brain, History, Plus } from "lucide-react";
import FileUploader from "./FileUploader";
import HistoryPanel from "./HistoryPanel";
import { generateNotes } from "@/lib/api";
import { useHUDStore } from "@/hooks/useHUD";
import { saveSessionData, loadSessionData } from "@/lib/sessions";
import { toast } from "sonner";

const TOPIC_SUGGESTIONS = [
  { label: "Key Concepts",  icon: <Brain size={16} />,    topic: "key concepts and main ideas" },
  { label: "Summary",       icon: <Sparkles size={16} />, topic: "complete summary" },
  { label: "Definitions",   icon: <FileText size={16} />, topic: "important definitions and terminology" },
  { label: "Examples",      icon: <Zap size={16} />,      topic: "examples and case studies" },
];

interface SavedNotes { notes: string; topic: string; detail: string; }

export default function NotesView({ restoreSessionId }: { restoreSessionId?: string }) {
  const [sessionId, setSessionId] = useState(() => restoreSessionId || crypto.randomUUID());
  const { refresh, refreshIfStale } = useHUDStore((s) => ({ refresh: s.refresh, refreshIfStale: s.refreshIfStale }));
  const [topic, setTopic] = useState("");
  const [detail, setDetail] = useState("Normal (Simplified)");
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [tab, setTab] = useState<"full" | "outline">("full");
  const [showHistory, setShowHistory] = useState(false);
  const notesContentRef = useRef<HTMLDivElement>(null);
  const notesScrollRef = useRef<HTMLDivElement>(null);

  // Restore from history navigation
  useEffect(() => {
    if (restoreSessionId) loadHistorySession(restoreSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async (customTopic?: string) => {
    const finalTopic = customTopic || topic;
    if (!finalTopic.trim()) { toast.error("Please enter a topic"); return; }
    setLoading(true);
    // Use existing sessionId so the PDF uploaded to this session is found on the backend
    const data = await generateNotes(finalTopic, detail, sessionId);
    setLoading(false);
    if (data?.content) {
      setNotes(data.content);
      setTopic(finalTopic);
      // Save to history
      const preview = `${finalTopic} · ${detail}`;
      saveSessionData(sessionId, "notes", preview, { notes: data.content, topic: finalTopic, detail } as SavedNotes, finalTopic);
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
    setSessionId(id);
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

      <div className="flex flex-col flex-1 overflow-hidden bg-bg-primary">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-bg-secondary/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent-purple/10 border border-accent-purple/20">
              <BookOpen size={18} className="text-accent-purple" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Smart Notes</h2>
              <p className="text-xs text-text-muted">
                {notes ? `${topic} · ${wordCount.toLocaleString()} words` : "AI-powered study notes from your documents"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={`p-2 rounded-lg border transition-all ${showHistory ? "border-accent-purple text-accent-purple bg-accent-purple/10" : "border-border text-text-muted hover:border-accent-purple/50 hover:text-accent-purple"}`}
              title="Notes history"
            ><History size={16} /></button>
            {notes && (
              <button onClick={handleNew} className="p-2 rounded-lg border border-border text-text-muted hover:border-accent-gold/50 hover:text-accent-gold transition-all" title="New notes">
                <Plus size={16} />
              </button>
            )}
            <FileUploader sessionId={sessionId} />
          </div>
        </div>

        {!notes ? (
          /* ── EMPTY STATE ── */
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 overflow-y-auto notes-scroll">
            <div className="w-full max-w-2xl">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-accent-purple/10 border border-accent-purple/20 mb-4">
                  <BookOpen size={40} className="text-accent-purple" />
                </div>
                <h3 className="text-2xl font-bold text-text-primary mb-2">Generate Study Notes</h3>
                <p className="text-text-muted text-sm max-w-md mx-auto">
                  Upload a PDF and create comprehensive notes on any topic. Perfect for exam prep and quick reviews.
                </p>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-2">What would you like notes on?</label>
                  <input
                    className="w-full bg-bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-purple focus:ring-2 focus:ring-accent-purple/20 transition-all"
                    placeholder="e.g., Machine Learning Basics, Chapter 3 Summary, Key Definitions..."
                    value={topic} onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-2">Detail Level</label>
                  <select
                    className="w-full bg-bg-card border border-border rounded-xl px-4 py-3 text-sm text-text-primary focus:outline-none focus:border-accent-purple focus:ring-2 focus:ring-accent-purple/20 transition-all"
                    value={detail} onChange={(e) => setDetail(e.target.value)}
                  >
                    <option>Normal (Simplified)</option>
                    <option>Ultra-detailed (Exam Ready)</option>
                  </select>
                </div>
                <button
                  onClick={() => handleGenerate()} disabled={loading || !topic.trim()}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-accent-purple to-accent-blue text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-accent-purple/20 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" />
                      <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" style={{animationDelay:'0.2s'}} />
                      <span className="loading-dot w-2 h-2 rounded-full bg-white inline-block" style={{animationDelay:'0.4s'}} />
                      Generating Notes...
                    </span>
                  ) : <><Sparkles size={18} />Generate Notes</>}
                </button>
              </div>

              <div>
                <p className="text-xs text-text-muted text-center mb-3">Or try these quick actions:</p>
                <div className="grid grid-cols-2 gap-3">
                  {TOPIC_SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => handleGenerate(s.topic)} disabled={loading}
                      className="flex items-center gap-2 px-4 py-3 rounded-lg bg-bg-card border border-border-subtle hover:border-accent-purple/50 text-text-secondary hover:text-text-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                      <span className="text-accent-purple">{s.icon}</span>
                      <span className="text-sm font-medium">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-8 p-4 bg-accent-purple/5 border border-accent-purple/20 rounded-lg">
                <h4 className="text-xs font-semibold text-text-primary mb-2 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-accent-purple" />Pro Tips
                </h4>
                <ul className="text-xs text-text-muted space-y-1">
                  <li>• Be specific about the topic for better notes</li>
                  <li>• Use "Ultra-detailed" mode for exam preparation</li>
                  <li>• Past notes are saved — open History to revisit them</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          /* ── NOTES DISPLAY ── */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Stats bar */}
            <div className="flex items-center gap-6 px-6 py-3 border-b border-border-subtle bg-bg-secondary/30">
              <div className="text-xs text-text-muted flex items-center gap-1.5"><FileText size={14} />{wordCount.toLocaleString()} words</div>
              <div className="text-xs text-text-muted flex items-center gap-1.5">⏱ ~{readingTime} min read</div>
              <div className="text-xs text-text-muted flex items-center gap-1.5">📄 {sections} sections</div>
              <div className="flex-1" />
              <a href={`data:text/markdown;charset=utf-8,${encodeURIComponent(notes)}`} download={`${topic || "notes"}.md`}
                className="text-xs text-text-muted hover:text-accent-purple flex items-center gap-1 transition-colors">
                <Download size={12} /> MD
              </a>
              <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(notes.replace(/[#*`]/g, ""))}`} download={`${topic || "notes"}.txt`}
                className="text-xs text-text-muted hover:text-accent-purple flex items-center gap-1 transition-colors">
                <Download size={12} /> TXT
              </a>
              <button onClick={handleNew} className="text-xs text-text-muted hover:text-accent-purple flex items-center gap-1 transition-colors">
                <RefreshCw size={12} /> New
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border-subtle px-6 bg-bg-secondary/30">
              {(["full", "outline"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors ${tab === t ? "border-accent-purple text-accent-purple" : "border-transparent text-text-muted hover:text-text-primary"}`}>
                  {t === "full" ? "📖 Full Notes" : "📑 Outline"}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto notes-scroll px-6 py-6">
              {tab === "full" && (
                <div ref={notesContentRef} className="notes-canvas max-w-3xl mx-auto prose prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
                </div>
              )}
              {tab === "outline" && (
                <div className="max-w-2xl mx-auto space-y-1">
                  {headers.length > 0 ? headers.map((h, i) => (
                    <button key={i} onClick={() => scrollToSection(h.text)}
                      style={{ paddingLeft: `${(h.level - 1) * 20}px` }}
                      className={`w-full text-left text-sm hover:bg-bg-hover rounded px-3 py-2 transition-colors ${h.level === 1 ? "font-semibold text-text-primary text-base mt-3" : h.level === 2 ? "font-medium text-text-secondary" : "text-text-muted"}`}>
                      {h.level === 1 ? "📌" : h.level === 2 ? "▸" : "•"} {h.text}
                    </button>
                  )) : (
                    <p className="text-text-muted text-sm italic text-center py-8">No structured outline detected.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}