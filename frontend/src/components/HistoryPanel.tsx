"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, Trash2, MessageSquare, HelpCircle, FileText, Layers, X, Plus } from "lucide-react";
import { loadMetadata, deleteSession } from "@/lib/sessions";
import { SessionMeta } from "@/types";

const MODE_ICONS: Record<string, React.ReactNode> = {
  chat:        <MessageSquare size={14} />,
  quiz:        <HelpCircle    size={14} />,
  notes:       <FileText      size={14} />,
  flashcards:  <Layers        size={14} />,
};

const MODE_COLORS: Record<string, string> = {
  chat:        "text-accent-blue   border-accent-blue/30   bg-accent-blue/10",
  quiz:        "text-accent-green  border-accent-green/30  bg-accent-green/10",
  notes:       "text-accent-purple border-accent-purple/30 bg-accent-purple/10",
  flashcards:  "text-accent-gold   border-accent-gold/30   bg-accent-gold/10",
};

const MODE_LABEL: Record<string, string> = {
  chat: "Chat", quiz: "Quiz", notes: "Notes", flashcards: "Flashcards",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

interface HistoryPanelProps {
  /** Which tab to show by default ("all" | "chat" | "quiz" | "notes" | "battle") */
  activeMode?: string;
  /** Called when user clicks a session to restore it */
  onSelect: (sessionId: string, type: string) => void;
  /** Called when user clicks "+ New" */
  onNew: () => void;
  onClose: () => void;
}

export default function HistoryPanel({ activeMode = "all", onSelect, onNew, onClose }: HistoryPanelProps) {
  const TABS = ["all", "chat", "quiz", "notes", "flashcards"] as const;
  const [tab, setTab] = useState<typeof TABS[number]>(
    TABS.includes(activeMode as any) ? (activeMode as any) : "all"
  );
  const [sessions, setSessions] = useState<[string, SessionMeta][]>([]);

  const reload = useCallback(() => {
    const meta = loadMetadata();
    const entries = (Object.entries(meta) as [string, SessionMeta][])
      .filter(([, m]) => m.type !== "arena" && m.type !== "battle");
    setSessions(
      entries.sort((a, b) => new Date(b[1].updated).getTime() - new Date(a[1].updated).getTime())
    );
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = tab === "all"
    ? sessions
    : sessions.filter(([, m]) => m.type === tab);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteSession(id);
    reload();
  };

  return (
    <div className="flex flex-col h-full bg-bg-secondary border-r border-border-subtle w-72 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-text-muted" />
          <span className="text-sm font-semibold text-text-primary pixel-font">History</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onNew}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg border border-border text-text-muted hover:text-accent-gold hover:border-accent-gold/50 transition-all"
          >
            <Plus size={12} /> New
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-border-subtle overflow-x-auto scrollbar-none">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-all pixel-font ${
              tab === t
                ? "bg-accent-gold/20 text-accent-gold border border-accent-gold/40"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {t === "all" ? "All" : MODE_LABEL[t] || t}
          </button>
        ))}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto sidebar-scroll py-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12 text-text-muted">
            <Clock size={32} className="mb-3 opacity-30" />
            <p className="text-xs">No history yet.</p>
            <p className="text-xs mt-1">Sessions are saved automatically.</p>
          </div>
        ) : (
          filtered.map(([id, meta]) => {
            const colorClass = MODE_COLORS[meta.type] || MODE_COLORS.chat;
            return (
              // FIX: was <button> — can't nest a <button> inside a <button>.
              // Changed to <div role="button"> so the delete <button> inside is valid HTML.
              <div
                key={id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(id, meta.type)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(id, meta.type); }}
                className="w-full text-left px-3 py-3 hover:bg-bg-hover transition-colors group border-b border-border-subtle/50 last:border-0 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Mode badge */}
                    <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${colorClass}`}>
                      {MODE_ICONS[meta.type] || <MessageSquare size={12} />}
                      {MODE_LABEL[meta.type] || meta.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-text-muted">{relativeTime(meta.updated)}</span>
                    <button
                      onClick={(e) => handleDelete(e, id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-accent-red transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-text-secondary mt-1.5 leading-relaxed line-clamp-2 pl-0.5">
                  {meta.preview || "Empty session"}
                </p>
                {(meta as any).title && (
                  <p className="text-[10px] text-text-muted mt-0.5 pl-0.5 truncate">{(meta as any).title}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}