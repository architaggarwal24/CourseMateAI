import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export type MeterTone = "accent" | "warning" | "danger" | "success" | "reward" | "epic" | "inverse";

export interface MeterProps {
  /** Accessible name. Give this or labelledBy. */
  label?: string;
  /** The id of an element that names the meter (instead of label). */
  labelledBy?: string;
  value: number;
  /** Defaults to 100. A max of 0 or less is treated as 1, so an empty range shows an empty bar. */
  max?: number;
  /** What a screen reader says instead of the bare number ("3 of 12"). */
  valueText?: string;
  /**
   * The fill colour. "inverse" is for a meter on an accent fill (light track, on-accent fill). "epic" is Insight's
   * purple. Use meterTone(share) for usage meters that warn as they fill.
   */
  tone?: MeterTone;
  /** Track height: sm 4px, md 6px (default), lg 8px. */
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Usage meters warn as they fill: the accent until 80%, then warning, then danger once full. */
export function meterTone(share: number): MeterTone {
  if (share >= 1) return "danger";
  if (share >= 0.8) return "warning";
  return "accent";
}

/**
 * The one progress bar (redesign Stage 2): quiz, deck and review progress, usage, XP, Insight, Today's goals.
 * The fill is scaled, not resized (no layout work as it grows), and glides with the theme's motion tokens, so it
 * steps in Hero and stands still under reduced motion (see .ui-meter in ui.css).
 */
export default function Meter({ label, labelledBy, value, max = 100, valueText, tone = "accent", size = "md", className }: MeterProps) {
  const top = max > 0 ? max : 1;
  const now = Math.min(top, Math.max(0, Number.isFinite(value) ? value : 0));
  const share = max > 0 ? now / top : 0;
  return (
    <div
      role="progressbar"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-valuemin={0}
      aria-valuemax={top}
      aria-valuenow={now}
      aria-valuetext={valueText}
      className={cn("ui-meter", className)}
      data-tone={tone}
      data-size={size}
    >
      <span className="ui-meter__fill" style={{ "--meter": String(Math.round(share * 10_000) / 10_000) } as CSSProperties} />
    </div>
  );
}
