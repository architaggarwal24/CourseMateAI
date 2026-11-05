"use client";

import { useSecondsLeft } from "@/hooks/useArenaBattle";

/**
 * The question clock: a ring that empties, with the seconds inside. Warns (amber, then red) as time runs low.
 * It ticks by itself (from `deadline`), so the rest of the battle screen does not re-render four times a second.
 */
export default function TimerRing({ deadline, total }: { deadline: number | null; total: number }) {
  const seconds = useSecondsLeft(deadline);
  const R = 22, C = 2 * Math.PI * R;
  const frac = seconds === null ? 0 : Math.max(0, Math.min(1, seconds / Math.max(1, total)));
  const urgency = seconds === null ? undefined : seconds <= 5 ? "critical" : seconds <= 10 ? "low" : undefined;
  return (
    <span className="arena-timer" role="timer" aria-label="Seconds left" data-urgency={urgency}>
      <svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
        <circle cx="28" cy="28" r={R} className="arena-timer__track" />
        <circle cx="28" cy="28" r={R} className="arena-timer__arc" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 28 28)" />
      </svg>
      <span className="arena-timer__num pixel-font">{seconds === null ? "--" : seconds}</span>
    </span>
  );
}
