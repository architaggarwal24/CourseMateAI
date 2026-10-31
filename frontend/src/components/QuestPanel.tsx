"use client";

import { useEffect } from "react";
import { useHUDStore } from "@/hooks/useHUD";
import { useHeroStore } from "@/hooks/useHero";
import { CheckCircle2, Circle, Sparkles } from "lucide-react";

export default function QuestPanel() {
  const quests = useHUDStore((s) => s.quests);
  const refresh = useHUDStore((s) => s.refresh);
  const guestMode = useHUDStore((s) => s.guestMode);
  // Claiming goes through the shared hero store: it marks the quest claimed and adds the reward to the header at once.
  const claim = useHeroStore((s) => s.claim);
  const pending = useHeroStore((s) => s.pending);

  // Refresh quests every 30s so completed quests appear without a manual page refresh
  useEffect(() => {
    if (guestMode) return;
    const interval = setInterval(() => { refresh(); }, 30_000);
    return () => clearInterval(interval);
  }, [guestMode, refresh]);

  if (!quests || quests.length === 0) {
    return (
      <div className="quest-empty">
        <p>No quests today</p>
      </div>
    );
  }

  return (
    <ul className="quest-list">
      {quests.map((q: any, idx: number) => {
        const progress = q.current_count || 0;
        const target = q.target_count || 1;
        const completed = q.completed === 1 || q.completed === true;
        const claimed = q.claimed === 1 || q.claimed === true;
        const pct = Math.min((progress / target) * 100, 100);
        const isClaiming = !!pending[`quest:${q.quest_type}`];
        const state = claimed ? "claimed" : completed ? "ready" : "open";

        return (
          <li key={idx} className="quest" data-state={state}>
            <div className="quest__head">
              <span className="quest__mark" aria-hidden="true">
                {completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              </span>
              <div className="quest__text">
                <p className="quest__title">{q.description}</p>
                <p className="quest__reward">
                  <span className="pixel-font">{q.reward_xp}</span> XP · <span className="pixel-font">{q.reward_coins}</span> coins
                </p>
              </div>
              <span className="quest__count pixel-font">{progress}/{target}</span>
            </div>

            <div className="quest__bar" role="progressbar" aria-label={q.description} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(progress, target)}>
              <div style={{ width: `${pct}%` }} />
            </div>

            {completed && !claimed && !isClaiming && (
              <button type="button" onClick={() => { void claim(q.quest_type); }} className="quest__claim">
                <Sparkles size={14} aria-hidden="true" />
                Claim Reward
              </button>
            )}

            {isClaiming && <div className="quest__claim" data-busy="true">Claiming...</div>}

            {claimed && (
              <div className="quest__done">
                <CheckCircle2 size={14} aria-hidden="true" />
                Claimed
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
