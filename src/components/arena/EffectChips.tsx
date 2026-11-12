"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, Ban, CloudFog, EyeOff, Flame, Lock, Shuffle, Snowflake, VolumeX, Zap, type IconType } from "@/components/ui/icons";
import type { ActiveEffect, EffectKind, Question } from "@/lib/arena/types";

const ICON: Record<EffectKind, IconType> = {
  dot: Flame, clock: Snowflake, lock: Lock, silence: VolumeX, curse: Ban, weaken: ArrowDown, blind: EyeOff, fog: CloudFog,
  shuffle: Shuffle, sap: Zap, drain: Zap,
};

export function EffectIcon({ kind, size = 14 }: { kind: EffectKind; size?: number }) {
  const Icon = ICON[kind] ?? Zap;
  return <Icon size={size} aria-hidden="true" />;
}

/**
 * The effects on your champion (Stage 3): an icon each, with the questions it still lasts. A creature's own effect
 * (its enraged form's) is marked. Said in words for screen readers, never by colour alone.
 */
export default function EffectChips({ effects }: { effects: ActiveEffect[] | undefined }) {
  if (!effects?.length) return null;
  return (
    <ul className="arena-effects" aria-label="Effects on you">
      {effects.map((e) => (
        <li key={e.id} className="arena-effect" data-kind={e.kind} data-boss={e.boss || undefined} title={`${e.name}: ${e.text}`}>
          <EffectIcon kind={e.kind} size={13} />
          <span className="arena-effect__turns pixel-font" aria-hidden="true">{e.turns}</span>
          <span className="sr-only">{`${e.name}, ${e.turns} more ${e.turns === 1 ? "question" : "questions"}: ${e.text}`}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the effects do to a question's screen while it is asked: the options hidden for the first seconds (Blind), the
 * question blurred (Fog), the options reshuffled while you answer (Confuse). The keys 1-4 follow the order shown.
 */
export function useQuestionFx(question: Question | null, asking: boolean): { order: string[]; blinded: boolean; fogged: boolean; shuffled: number } {
  const fx = question?.effects ?? null;
  const [elapsed, setElapsed] = useState(0);
  const id = question?.id;
  useEffect(() => {
    setElapsed(0);
    if (!fx || !asking) return;
    const start = Date.now();
    const t = setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    return () => clearInterval(t);
  }, [id, asking]); // eslint-disable-line react-hooks/exhaustive-deps
  // the reshuffles land at even points of the clock (a rotation each time: every option moves)
  const total = Math.max(1, question?.time_limit ?? 30);
  const shuffles = fx?.shuffle ?? 0;
  const done = shuffles ? Math.min(shuffles, Math.floor((elapsed / total) * (shuffles + 1))) : 0;
  const order = useMemo(() => {
    const options = question?.options ?? [];
    if (!done || options.length < 2) return options;
    const k = done % options.length || 1;
    return [...options.slice(k), ...options.slice(0, k)];
  }, [question?.options, done]);
  return { order, blinded: !!fx?.blind && asking && elapsed < fx.blind, fogged: !!fx?.fog && asking && elapsed < fx.fog, shuffled: done };
}
