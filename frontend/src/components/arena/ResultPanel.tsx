"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Coins, Sparkles, Trophy } from "lucide-react";
import { ROUTES } from "@/lib/routes";
import { Badge, Button } from "@/components/ui";
import PixelSprite from "./pixel/PixelSprite";
import { useFighter } from "./pixel/useFighter";
import { fetchLeaderboard } from "@/lib/arena/api";
import type { Battle, BattleRewards, LeaderboardEntry } from "@/lib/arena/types";
import { DIFFICULTY_LABEL } from "@/lib/arena/types";

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;

function totals(rewards: BattleRewards | null) {
  let xp = 0, coins = 0;
  for (const award of rewards ? [rewards.arena_round_complete, rewards.boss_defeat] : []) {
    xp += Number(award?.xp_gained ?? 0);
    coins += Number(award?.coins_gained ?? 0);
  }
  return { xp, coins };
}

/** How the battle ended - win, loss or retreat - with the server's grade, accuracy and time and what it paid. */
export default function ResultPanel({ battle, rewards, retreated, bossName, onAgain, againLabel }: {
  battle: Battle;
  rewards: BattleRewards | null;
  retreated: boolean;
  bossName: string;
  onAgain: () => void;
  againLabel?: string;
}) {
  const won = battle.status === "won";
  const fighter = useFighter();
  const result = battle.result ?? {};
  const { xp, coins } = totals(rewards);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    if (!won) return;
    const controller = new AbortController();
    fetchLeaderboard(battle.topic, battle.difficulty, controller.signal)
      .then((r) => { if (!controller.signal.aborted) setEntries(r.entries ?? []); })
      .catch(() => { /* the board is a bonus */ });
    return () => controller.abort();
  }, [won, battle.topic, battle.difficulty]);

  const headline = won ? "Victory!" : retreated ? "Retreated" : "Defeated";
  const line = won
    ? `You defeated ${bossName}.`
    : retreated ? `You retreated from ${bossName}.` : `${bossName} was too strong this time.`;
  const accuracy = result.accuracy ?? (battle.answered ? Math.round((battle.correct / battle.answered) * 100) : 0);

  return (
    <section className="arena-result" data-outcome={won ? "won" : "lost"} aria-labelledby="arena-result-title">
      <div className="arena-result__figure"><PixelSprite hero={fighter} anim={won ? "win" : "hit"} label={won ? `${fighter.name} celebrates` : `${fighter.name}, beaten`} className="arena-result__sprite" /></div>
      <h2 id="arena-result-title" ref={heading} tabIndex={-1} className="arena-result__headline pixel-font">{headline}</h2>
      <p className="arena__text">{line} <span className="text-muted">({battle.topic}, {DIFFICULTY_LABEL[battle.difficulty]})</span></p>
      {won && result.grade && <span className="arena-result__grade pixel-font" role="img" aria-label={`Grade ${result.grade}`}>{result.grade}</span>}
      {result.new_personal_best && <Badge tone="reward"><Trophy size={12} aria-hidden="true" />New best</Badge>}

      <dl className="arena-result__stats">
        <div><dt>Accuracy</dt><dd className="pixel-font">{accuracy}%</dd></div>
        <div><dt>Correct</dt><dd className="pixel-font">{battle.correct}/{battle.answered}</dd></div>
        <div><dt>Best combo</dt><dd className="pixel-font">x{battle.max_combo}</dd></div>
        {typeof result.time_seconds === "number" && <div><dt>Time</dt><dd className="pixel-font">{mmss(result.time_seconds)}</dd></div>}
      </dl>

      {(xp > 0 || coins > 0) && (
        <p className="arena-result__rewards" aria-label="Rewards">
          {xp > 0 && <Badge tone="accent"><Sparkles size={12} aria-hidden="true" />+{xp} XP</Badge>}
          {coins > 0 && <Badge tone="reward"><Coins size={12} aria-hidden="true" />+{coins} coins</Badge>}
        </p>
      )}

      {entries.length > 0 && (
        <ol className="arena-board w-full text-left">
          {entries.slice(0, 5).map((e) => (
            <li key={`${e.rank}-${e.username}`} className="arena-board__row" data-me={e.is_me ? "true" : undefined}>
              <span>{e.rank}.</span><span className="arena-board__name">{e.username}</span>
              <span className="arena-board__grade pixel-font">{e.grade}</span><span>{e.accuracy}%</span><span>{mmss(e.time)}</span>
            </li>
          ))}
        </ol>
      )}

      {(result.missed?.length ?? 0) > 0 && (
        <section className="arena-loot" aria-labelledby="arena-loot-title">
          <h3 id="arena-loot-title" className="arena-loot__title"><BookOpen size={16} aria-hidden="true" />Study scrolls · {result.missed!.length} to review</h3>
          <ul className="arena-loot__list">
            {result.missed!.slice(0, 4).map((m, i) => (
              <li key={i} className="arena-loot__item">
                <span className="arena-loot__concept">{m.concept}</span>
                <span className="arena-loot__q">{m.question}</span>
                <span className="arena-loot__a">Answer: {m.correct_answer}</span>
              </li>
            ))}
          </ul>
          <Link href={`${ROUTES.studyTab("flashcards")}&review=1`} className="ui-btn ui-btn--secondary ui-btn--sm fx-sheen">
            <BookOpen size={14} aria-hidden="true" />Review them as flashcards
          </Link>
        </section>
      )}

      <Button variant="primary" onClick={onAgain}>{againLabel ?? "Battle again"}</Button>
    </section>
  );
}
