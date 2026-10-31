"use client";

import type { ReactNode } from "react";
import { History, Plus } from "lucide-react";
import { Button } from "@/components/ui";

interface Props {
  title: string;
  subtitle: string;
  /** Name of what the history button opens, e.g. "Notes history". */
  historyLabel?: string;
  historyOpen?: boolean;
  /** Without it there is no history button. */
  onToggleHistory?: () => void;
  /** Shows a "new" button (label given) that starts over. */
  onNew?: () => void;
  newLabel?: string;
  /** More buttons, placed before the history button. */
  children?: ReactNode;
}

/** The title band every Study tool shares: what this is, then its history / new / extra buttons. */
export default function StudyToolbar({ title, subtitle, historyLabel, historyOpen, onToggleHistory, onNew, newLabel = "New", children }: Props) {
  return (
    <div className="ws-toolbar">
      <div className="min-w-0">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {children}
        {onToggleHistory && (
          <Button size="sm" icon pressed={historyOpen} onClick={onToggleHistory} aria-label={historyLabel} title={historyLabel}>
            <History size={16} />
          </Button>
        )}
        {onNew && (
          <Button size="sm" icon onClick={onNew} aria-label={newLabel} title={newLabel}><Plus size={16} /></Button>
        )}
      </div>
    </div>
  );
}
