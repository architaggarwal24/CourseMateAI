"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, Trash2, X, Plus } from "lucide-react";
import { Button, EmptyState, Tabs } from "@/components/ui";
import { loadMetadata, deleteSession } from "@/lib/sessions";
import { SessionMeta } from "@/types";
import { MODE_META, formatWhen, modeMeta } from "./history/sessionMeta";

interface HistoryPanelProps {
  /** Which tab to show by default ("all" | "chat" | "quiz" | "notes" | "flashcards") */
  activeMode?: string;
  /** Called when user clicks a session to restore it */
  onSelect: (sessionId: string, type: string) => void;
  /** Called when user clicks "+ New" */
  onNew: () => void;
  onClose: () => void;
}

const TABS = ["all", "chat", "quiz", "notes", "flashcards"] as const;
type PanelTab = typeof TABS[number];

export default function HistoryPanel({ activeMode = "all", onSelect, onNew, onClose }: HistoryPanelProps) {
  const [tab, setTab] = useState<PanelTab>(TABS.includes(activeMode as PanelTab) ? (activeMode as PanelTab) : "all");
  const [sessions, setSessions] = useState<[string, SessionMeta & { title?: string }][]>([]);

  const reload = useCallback(() => {
    const meta = loadMetadata();
    const entries = (Object.entries(meta) as [string, SessionMeta & { title?: string }][])
      .filter(([, m]) => m.type !== "arena" && m.type !== "battle");
    setSessions(entries.sort((a, b) => new Date(b[1].updated).getTime() - new Date(a[1].updated).getTime()));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const filtered = tab === "all" ? sessions : sessions.filter(([, m]) => m.type === tab);

  const handleDelete = (id: string) => {
    deleteSession(id);
    reload();
  };

  return (
    <aside aria-label="History" className="history-drawer">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[color:var(--glass-border)]">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Clock size={16} className="text-fg-muted" aria-hidden="true" />History
        </h2>
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={onNew}><Plus size={14} aria-hidden="true" />New</Button>
          <Button size="sm" variant="ghost" icon onClick={onClose} aria-label="Close history"><X size={16} /></Button>
        </div>
      </div>

      <Tabs
        label="History filter"
        value={tab}
        onChange={(id) => setTab(id as PanelTab)}
        className="px-2 [&_.ui-tab]:px-2.5 [&_.ui-tab]:text-xs"
        tabs={TABS.map((t) => ({ id: t, label: t === "all" ? "All" : MODE_META[t].label }))}
      />

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState icon={<Clock size={28} />} title="No history yet" description="Sessions are saved automatically as you study." />
        ) : (
          <ul className="m-0 list-none p-0">
            {filtered.map(([id, meta]) => {
              const mode = modeMeta(meta.type);
              const when = formatWhen(meta.updated);
              return (
                <li key={id} className="history-item group relative border-b border-[color:var(--glass-border)] last:border-0">
                  <button type="button" onClick={() => onSelect(id, meta.type)}
                          className="block w-full px-4 py-3 pr-11 text-left">
                    <span className="flex items-center gap-2 text-xs text-fg-muted">
                      <span className="text-fg-2">{mode.icon(14)}</span>
                      <span className="font-medium text-fg-2">{mode.label}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={meta.updated} title={when.full}>{when.text}</time>
                    </span>
                    <span className="mt-1.5 block text-sm leading-[1.5] text-fg line-clamp-2">
                      {meta.preview || "Empty session"}
                    </span>
                    {meta.title && <span className="mt-0.5 block text-xs text-fg-muted truncate">{meta.title}</span>}
                  </button>
                  <Button size="sm" variant="ghost" icon onClick={() => handleDelete(id)}
                          aria-label={`Delete ${mode.label.toLowerCase()} session`} title="Delete session"
                          className="absolute right-2 top-2">
                    <Trash2 size={14} />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
