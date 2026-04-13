"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Clock, Trash2, MessageSquare, HelpCircle, FileText,
  Layers, Search, X, RotateCcw, ChevronRight,
} from "lucide-react";
import { loadMetadata, loadSession, loadSessionData, deleteSession } from "@/lib/sessions";
import { SessionMeta } from "@/types";

type AnyMode = "chat" | "quiz" | "flashcards" | "notes";

const MODE_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  chat:       { icon: <MessageSquare size={14} />, label: "Chat",       color: "text-accent-blue   border-accent-blue/30   bg-accent-blue/10"   },
  quiz:       { icon: <HelpCircle    size={14} />, label: "Quiz",       color: "text-accent-green  border-accent-green/30  bg-accent-green/10"  },
  notes:      { icon: <FileText      size={14} />, label: "Notes",      color: "text-accent-purple border-accent-purple/30 bg-accent-purple/10" },
  flashcards: { icon: <Layers        size={14} />, label: "Flashcards", color: "text-accent-gold   border-accent-gold/30   bg-accent-gold/10"   },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 7)  return `${d} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getMessageCount(sessionId: string, type: string): number {
  try {
    if (type === "chat") {
      const msgs = loadSession(sessionId);
      return Array.isArray(msgs) ? msgs.filter((m: any) => m.role === "user").length : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

interface HistoryViewProps {
  onNavigate?: (mode: AnyMode, sessionId: string) => void;
}

const TABS = ["all", "chat", "quiz", "flashcards", "notes"] as const;

export default function HistoryView({ onNavigate }: HistoryViewProps) {
  const [tab, setTab] = useState<typeof TABS[number]>("all");
  const [sessions, setSessions] = useState<[string, SessionMeta & { title?: string }][]>([]);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    const meta = loadMetadata();
    const entries = (Object.entries(meta) as [string, SessionMeta & { title?: string }][])
      .filter(([, m]) => m.type !== "arena" && m.type !== "battle");
    setSessions(
      entries.sort((a, b) => new Date(b[1].updated).getTime() - new Date(a[1].updated).getTime())
    );
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = sessions.filter(([id, m]) => {
    const typeMatch =
      tab === "all" ||
      m.type === tab;
    const q = search.toLowerCase();
    const textMatch =
      !q ||
      (m.preview || "").toLowerCase().includes(q) ||
      (m.title || "").toLowerCase().includes(q);
    return typeMatch && textMatch;
  });

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    setTimeout(() => {
      deleteSession(id);
      reload();
      setDeletingId(null);
    }, 200);
  };

  const handleOpen = (id: string, type: string) => {
    const mode =
      type === "flashcards" ? "flashcards" :
      (type as AnyMode) || "chat";
    onNavigate?.(mode, id);
  };

  return (
    <div className="flex flex-col h-full bg-bg-primary overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b-4 border-border-subtle bg-bg-secondary flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <Clock size={20} className="text-accent-gold" />
          <h2 className="text-lg font-black pixel-font text-text-primary tracking-wide">Session History</h2>
          <span className="ml-auto text-xs text-text-muted pixel-font">{sessions.length} sessions</span>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search sessions…"
            className="w-full pl-9 pr-8 py-2 text-sm bg-bg-card border-2 border-border rounded-lg text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-gold transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2.5 border-b-4 border-border-subtle bg-bg-secondary overflow-x-auto scrollbar-none flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded text-[11px] font-semibold whitespace-nowrap transition-all pixel-font ${
              tab === t
                ? "bg-accent-gold/20 text-accent-gold border-2 border-accent-gold/40"
                : "text-text-muted hover:text-text-primary border-2 border-transparent"
            }`}
          >
            {t === "all" ? "All" : MODE_META[t]?.label || t}
            {t !== "all" && (
              <span className="ml-1.5 opacity-60">
                {sessions.filter(([, m]) => m.type === t).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8 py-16 text-text-muted">
            <Clock size={40} className="mb-4 opacity-20" />
            <p className="text-sm font-semibold pixel-font mb-1">
              {search ? "No sessions match your search" : "No sessions yet"}
            </p>
            <p className="text-xs opacity-70">
              {search ? "Try a different search term" : "Sessions are saved automatically as you study"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border-subtle/50">
            {filtered.map(([id, meta]) => {
              const m = MODE_META[meta.type] || MODE_META.chat;
              const msgCount = getMessageCount(id, meta.type);
              const isDeleting = deletingId === id;

              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleOpen(id, meta.type)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") handleOpen(id, meta.type); }}
                  className={`group flex items-start gap-4 px-5 py-4 hover:bg-bg-secondary transition-all cursor-pointer ${isDeleting ? "opacity-30 scale-95" : ""}`}
                >
                  {/* Mode icon */}
                  <div className={`mt-0.5 flex-shrink-0 p-2 rounded-lg border ${m.color}`}>
                    {m.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-semibold pixel-font px-1.5 py-0.5 rounded border ${m.color}`}>
                        {m.label}
                      </span>
                      {meta.title && (
                        <span className="text-xs font-semibold text-text-primary truncate max-w-[180px]">
                          {meta.title}
                        </span>
                      )}
                    </div>

                    <p className="text-sm text-text-secondary line-clamp-2 leading-relaxed">
                      {meta.preview || "Empty session"}
                    </p>

                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[11px] text-text-muted">{relativeTime(meta.updated)}</span>
                      {msgCount > 0 && (
                        <span className="text-[11px] text-text-muted">
                          {msgCount} {msgCount === 1 ? "message" : "messages"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={e => handleDelete(e, id)}
                      className="p-1.5 rounded-lg hover:bg-accent-red/20 hover:text-accent-red text-text-muted transition-colors"
                      title="Delete session"
                    >
                      <Trash2 size={13} />
                    </button>
                    <div className="p-1.5 rounded-lg text-text-muted group-hover:text-accent-gold transition-colors">
                      <ChevronRight size={13} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {sessions.length > 0 && (
        <div className="px-5 py-3 border-t-4 border-border-subtle bg-bg-secondary flex-shrink-0 flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {filtered.length} of {sessions.length} sessions
          </span>
          <button
            onClick={reload}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-accent-gold transition-colors pixel-font"
          >
            <RotateCcw size={11} /> Refresh
          </button>
        </div>
      )}
    </div>
  );
}