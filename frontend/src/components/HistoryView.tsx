"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, Trash2, Search, X, RotateCcw, ChevronRight } from "lucide-react";
import { Button, EmptyState, Input, Tabs } from "@/components/ui";
import { loadMetadata, loadSession, deleteSession } from "@/lib/sessions";
import { SessionMeta } from "@/types";
import { MODE_META, formatWhen, modeMeta } from "./history/sessionMeta";

type AnyMode = "chat" | "quiz" | "flashcards" | "notes";

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
type ViewTab = typeof TABS[number];

export default function HistoryView({ onNavigate }: HistoryViewProps) {
  const [tab, setTab] = useState<ViewTab>("all");
  const [sessions, setSessions] = useState<[string, SessionMeta & { title?: string }][]>([]);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(() => {
    const meta = loadMetadata();
    const entries = (Object.entries(meta) as [string, SessionMeta & { title?: string }][])
      .filter(([, m]) => m.type !== "arena" && m.type !== "battle");
    setSessions(entries.sort((a, b) => new Date(b[1].updated).getTime() - new Date(a[1].updated).getTime()));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = sessions.filter(([, m]) => {
    const typeMatch = tab === "all" || m.type === tab;
    const q = search.toLowerCase();
    const textMatch = !q || (m.preview || "").toLowerCase().includes(q) || (m.title || "").toLowerCase().includes(q);
    return typeMatch && textMatch;
  });

  const handleDelete = (id: string) => {
    setDeletingId(id);
    setTimeout(() => {
      deleteSession(id);
      reload();
      setDeletingId(null);
    }, 200);
  };

  const handleOpen = (id: string, type: string) => {
    onNavigate?.(((type as AnyMode) || "chat"), id);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-6 pt-5 pb-3">
        <div className="mx-auto w-full max-w-[72ch] space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-fg">Session history</h2>
            <span className="text-xs text-fg-muted">{sessions.length} {sessions.length === 1 ? "session" : "sessions"}</span>
          </div>
          <Input
            aria-label="Search sessions"
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leading={<Search size={14} aria-hidden="true" />}
            trailing={search ? (
              <Button size="sm" variant="ghost" icon onClick={() => setSearch("")} aria-label="Clear search"><X size={13} /></Button>
            ) : undefined}
          />
        </div>
      </div>

      <div className="shrink-0 px-6">
        <div className="mx-auto w-full max-w-[72ch]">
          <Tabs
            label="History filter"
            value={tab}
            onChange={(id) => setTab(id as ViewTab)}
            tabs={TABS.map((t) => ({
              id: t,
              label: t === "all" ? "All" : `${MODE_META[t].label} ${sessions.filter(([, m]) => m.type === t).length}`,
            }))}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div className="mx-auto w-full max-w-[72ch]">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Clock size={32} />}
              title={search ? "No sessions match your search" : "No sessions yet"}
              description={search ? "Try a different search term." : "Sessions are saved automatically as you study."}
            />
          ) : (
            <ul aria-label="Sessions" className="m-0 list-none space-y-2 p-0">
              {filtered.map(([id, meta]) => {
                const mode = modeMeta(meta.type);
                const msgCount = getMessageCount(id, meta.type);
                const when = formatWhen(meta.updated);
                return (
                  <li key={id} className={`review-item !p-0 group relative transition-[opacity,transform] duration-300 hover:-translate-y-0.5 ${deletingId === id ? "opacity-30" : ""}`}>
                    <button type="button" onClick={() => handleOpen(id, meta.type)}
                            className="flex w-full items-start gap-4 rounded-[var(--radius-lg)] px-4 py-3 pr-24 text-left">
                      <span className="ws-doc__icon mt-0.5">
                        {mode.icon(16)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-medium text-fg">{mode.label}</span>
                          {meta.title && <span className="truncate text-sm text-fg-muted">· {meta.title}</span>}
                        </span>
                        <span className="mt-1 block text-sm leading-[1.5] text-fg-2 line-clamp-2">{meta.preview || "Empty session"}</span>
                        <span className="mt-1.5 flex items-center gap-3 text-xs text-fg-muted">
                          <time dateTime={meta.updated} title={when.full}>{when.text}</time>
                          {msgCount > 0 && <span>{msgCount} {msgCount === 1 ? "message" : "messages"}</span>}
                        </span>
                      </span>
                    </button>
                    <span className="absolute right-3 top-3 flex items-center gap-1">
                      <Button size="sm" variant="ghost" icon onClick={() => handleDelete(id)}
                              aria-label={`Delete ${mode.label.toLowerCase()} session`} title="Delete session">
                        <Trash2 size={14} />
                      </Button>
                      <ChevronRight size={14} className="text-fg-muted" aria-hidden="true" />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="ws-bar !mb-0">
          <div className="mx-auto flex w-full max-w-[72ch] items-center justify-between">
            <span className="text-xs text-fg-muted">{filtered.length} of {sessions.length} sessions</span>
            <Button size="sm" variant="ghost" onClick={reload}><RotateCcw size={12} aria-hidden="true" />Refresh</Button>
          </div>
        </div>
      )}
    </div>
  );
}
