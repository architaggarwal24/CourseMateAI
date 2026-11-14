"use client";

import { useState } from "react";
import { BookOpen, CalendarClock, Coins, ScrollText, Sparkles, Sun, Sword } from "@/components/ui/icons";
import { Badge, Button, ButtonLink } from "@/components/ui";
import { useReducedMotionConfig } from "motion/react";
import { callHref, callLabel, type Scroll, type ScrollKind } from "@/lib/quests/board";

const SEAL_ICON: Record<ScrollKind, typeof Sun> = { daily: Sun, weekly: CalendarClock, hunt: Sword, story: BookOpen };
const KIND_LABEL: Record<ScrollKind, string> = { daily: "Daily quest", weekly: "Weekly trial", hunt: "Hunt", story: "Story" };
/** How long the seal takes to break before the reward is claimed. */
export const BREAK_MS = 450;

/**
 * One quest as a sealed scroll (Stage Q1). Open: its button (what you'll do: "Take a quiz", "Fight") goes where it is done. Done: the seal is cracked
 * and "Break the seal" claims the reward (the wax splits first). Claimed: the scroll lies open.
 */
export default function QuestScroll({ scroll, onClaim, busy, creature }: {
  scroll: Scroll;
  onClaim: (s: Scroll) => Promise<unknown> | void;
  busy?: boolean;
  /** A hunt's creature name (for its lost page). */
  creature?: string;
}) {
  const reduced = !!useReducedMotionConfig();
  const [breaking, setBreaking] = useState(false);
  const Icon = SEAL_ICON[scroll.kind];
  const state = scroll.claimed ? "open" : scroll.completed ? "ready" : "sealed";
  const pct = Math.round((Math.min(scroll.progress, scroll.target) / Math.max(1, scroll.target)) * 100);
  const titleId = `scroll-${scroll.id.replace(/[^a-z0-9]/gi, "-")}`;

  const breakSeal = () => {
    if (breaking || busy) return;
    if (reduced) { void onClaim(scroll); return; }
    setBreaking(true);
    setTimeout(() => { void Promise.resolve(onClaim(scroll)).finally(() => setBreaking(false)); }, BREAK_MS);
  };

  return (
    <li className="qscroll" data-state={state} data-kind={scroll.kind} data-breaking={breaking || undefined} aria-labelledby={titleId}>
      <span className="qscroll__seal" aria-hidden="true">
        <span className="qscroll__half qscroll__half--l" />
        <span className="qscroll__half qscroll__half--r" />
        <Icon size={16} className="qscroll__sigil" />
      </span>
      <div className="qscroll__body">
        <p className="qscroll__kind">{KIND_LABEL[scroll.kind]}{state === "open" ? " · seal broken" : state === "ready" ? " · done" : ""}</p>
        <h4 id={titleId} className="qscroll__title">{scroll.title}</h4>
        {scroll.text && <p className="qscroll__text">{scroll.text}</p>}
        <div className="qscroll__progress">
          <div className="qscroll__bar" role="progressbar" aria-label={`${scroll.title}: progress`} aria-valuemin={0} aria-valuemax={scroll.target} aria-valuenow={Math.min(scroll.progress, scroll.target)}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="qscroll__count pixel-font">{Math.min(scroll.progress, scroll.target)}/{scroll.target}</span>
        </div>
        <p className="qscroll__reward" aria-label={`Reward: ${scroll.reward.xp} XP and ${scroll.reward.coins} coins${scroll.lost_page ? ", and a lost Bestiary page" : ""}`}>
          <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />{scroll.reward.xp} XP</Badge>
          <Badge tone="reward"><Coins size={12} aria-hidden="true" />{scroll.reward.coins}</Badge>
          {scroll.lost_page && <Badge tone="epic"><ScrollText size={12} aria-hidden="true" />Lost page{creature ? `: ${creature}` : ""}</Badge>}
        </p>
        <div className="qscroll__actions">
          {state === "sealed" && (
            <ButtonLink href={callHref(scroll.call)} size="sm" variant="primary">{callLabel(scroll.call)}</ButtonLink>
          )}
          {state === "ready" && (
            <Button size="sm" variant="reward" onClick={breakSeal} loading={busy || breaking} aria-label={`Break the seal: claim ${scroll.title}`}>
              Break the seal
            </Button>
          )}
          {state === "open" && <span className="qscroll__done">Reward claimed</span>}
        </div>
      </div>
    </li>
  );
}
