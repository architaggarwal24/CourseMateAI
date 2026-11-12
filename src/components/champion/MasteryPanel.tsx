"use client";

import { Check } from "@/components/ui/icons";
import type { ChampionProgress } from "@/hooks/useChampion";

/** Champion mastery 0-100%: the bar, the six challenges, and what 50% and 100% bring. */
export default function MasteryPanel({ name, p, brief }: { name: string; p: ChampionProgress; brief?: boolean }) {
  const pct = p.mastery_pct ?? 0;
  const challenges = p.challenges ?? [];
  return (
    <div className="champ-masterypct" data-testid="champion-mastery" data-mastered={p.mastered || undefined}>
      <div className="champ-masterypct__head">
        <p className="hero-label m-0">{name}&apos;s mastery</p>
        <span className="champ-masterypct__pct pixel-font">{p.mastered ? "Mastered" : `${pct}%`}</span>
      </div>
      <div className="champ-masterypct__bar" role="progressbar" aria-label={`${name}'s mastery`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
        <i style={{ left: "50%" }} aria-hidden="true" />
      </div>
      {!brief && <p className="m-0 text-xs text-fg-muted">70% from {name}&apos;s level, 30% from these challenges. Studying counts while {name} is your champion.</p>}
      <ul className="champ-challenges" aria-label={`${name}'s mastery challenges`}>
        {challenges.map((c) => (
          <li key={c.id} className="champ-challenge" data-done={c.done || undefined}>
            <span className="champ-challenge__mark" aria-hidden="true">{c.done ? <Check size={12} /> : null}</span>
            <span className="min-w-0 flex-1">{c.text}</span>
            <span className="text-xs text-fg-muted">{c.done ? <span className="sr-only">done</span> : `${c.progress}/${c.target}`}</span>
          </li>
        ))}
      </ul>
      <ul className="champ-milestones">
        <li data-reached={p.passive_learnable || undefined}><strong>50%</strong> · your hero can learn {p.kit.passive.name}</li>
        <li data-reached={p.mastered || undefined}><strong>100%</strong> · your hero earns {name}&apos;s fighting style, emotes, {p.kit.ultimate.name} and look</li>
      </ul>
    </div>
  );
}
