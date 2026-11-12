"use client";

import { Brain } from "@/components/ui/icons";
import { useHUDStore } from "@/hooks/useHUD";

export const INSIGHT_MAX = 100;

/**
 * Insight (the two worlds, Stage 5): studying fills it; full, your next fight starts with +1 Focus and a free 50/50.
 * Shown in both worlds: a bar and what it does.
 */
export default function InsightMeter({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const insight = useHUDStore((s) => s.insight ?? 0);
  const pct = Math.max(0, Math.min(100, Math.round((insight / INSIGHT_MAX) * 100)));
  const full = pct >= 100;
  return (
    <div className={`insight ${className}`} data-full={full || undefined} data-testid="insight">
      <span className="insight__label"><Brain size={13} aria-hidden="true" />Insight</span>
      <span className="insight__bar" role="progressbar" aria-label="Insight" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></span>
      {!compact && <span className="insight__hint">{full ? "Full: your next fight starts with +1 Focus and a free 50/50." : "Study to fill it. Full, your next fight gets an edge."}</span>}
    </div>
  );
}
