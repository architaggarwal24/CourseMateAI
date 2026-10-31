"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Flame, Skull, Swords, Target, Trophy } from "lucide-react";
import { GearChips } from "@/components/avatar";
import PixelSprite from "./pixel/PixelSprite";
import { useFighter } from "./pixel/useFighter";
import FileUploader from "@/components/FileUploader";
import { Badge, Button, Input } from "@/components/ui";
import { previewEquipped, useHeroStore } from "@/hooks/useHero";
import { totalGear } from "@/lib/gear";
import { fetchLeaderboard, fetchWeakConcepts } from "@/lib/arena/api";
import { DIFFICULTIES, DIFFICULTY_BLURB, DIFFICULTY_LABEL, type Difficulty, type LeaderboardEntry, type WeakConceptsResponse } from "@/lib/arena/types";

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;

/** Pick a document, a topic and a difficulty; the server builds the boss. */
export default function SummonPanel({ sessionId, starting, onSummon, mode = "quick", onBack }: {
  sessionId: string;
  starting: boolean;
  onSummon: (topic: string, difficulty: Difficulty, mode: "quick" | "nemesis") => void;
  /** "nemesis": no topic - the boss is built from the concepts the player keeps missing. */
  mode?: "quick" | "nemesis";
  onBack?: () => void;
}) {
  const nemesis = mode === "nemesis";
  const fighter = useFighter();
  const [weak, setWeak] = useState<WeakConceptsResponse | null>(null);
  useEffect(() => {
    if (!nemesis || !sessionId) return;
    let alive = true;
    fetchWeakConcepts(sessionId).then((r) => { if (alive) setWeak(r); }).catch(() => { if (alive) setWeak({ concepts: [], missed_total: 0, nemesis_ready: false }); });
    return () => { alive = false; };
  }, [nemesis, sessionId]);
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const shop = useHeroStore((s) => s.shop);
  const equipped = previewEquipped(shop, null);
  const worn = ["weapon", "armor", "headgear", "pet"].map((k) => shop?.items.find((i) => i.id === (equipped[k] || (k === "armor" ? equipped.outfit_id : ""))));
  const gear = totalGear(worn as never);

  // The board for this topic and difficulty (what the server has recorded), after the player stops typing.
  useEffect(() => {
    const trimmed = topic.trim();
    if (!trimmed || nemesis) { setEntries([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetchLeaderboard(trimmed, difficulty, controller.signal);
        if (!controller.signal.aborted) setEntries(r.entries ?? []);
      } catch { /* the board is optional: the summon works without it */ }
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [topic, difficulty, nemesis]);

  const mine = entries.find((e) => e.is_me);
  const canSummon = (nemesis ? !!weak?.nemesis_ready : topic.trim().length > 0) && !starting;
  const submit = () => { if (canSummon) onSummon(topic.trim(), difficulty, mode); };

  const LEVEL = { easy: 1, medium: 2, hard: 3, nightmare: 4 } as const;

  return (
    <section className="arena-summon" aria-labelledby="arena-summon-title">
      <aside className="arena-summon__hero" aria-label="Your hero">
        <div className="arena-summon__spot">
          <PixelSprite hero={fighter} label={`${fighter.name}, your champion`} className="arena-summon__sprite" />
        </div>
        <p className="arena-summon__name"><span className="pixel-font">{fighter.name}</span> is ready</p>
        {Object.values(gear).some(Boolean)
          ? <GearChips stats={gear} />
          : <p className="arena-summon__hint">Your gear shows here. A weapon, armor, headgear or a pet gives you an edge.</p>}
      </aside>

      <div className="arena-summon__panel">
        <div className="arena-summon__head">
          <div>
            {onBack && <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-1"><ArrowLeft size={14} aria-hidden="true" />Arena</Button>}
            <h2 id="arena-summon-title" className="arena__title">{nemesis ? "Nemesis" : "Quick Battle"}</h2>
            <p className="arena__sub">{nemesis
              ? "A boss built from the concepts you keep getting wrong - in quizzes, flashcards and the arena."
              : "Summon a boss from your document and defeat it with what you know."}</p>
          </div>
          <FileUploader sessionId={sessionId} />
        </div>

        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <fieldset className="grid gap-2 border-0 p-0 m-0">
            <legend className="text-sm text-fg-2 mb-2">Difficulty</legend>
            <ul className="arena-difficulties">
              {DIFFICULTIES.map((d) => (
                <li key={d}>
                  <button type="button" className="arena-difficulty" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>
                    <span className="arena-difficulty__top">
                      {d === "nightmare" ? <Skull size={16} aria-hidden="true" /> : d === "hard" ? <Flame size={16} aria-hidden="true" /> : <Swords size={16} aria-hidden="true" />}
                      {DIFFICULTY_LABEL[d]}
                    </span>
                    <span className="arena-difficulty__skulls" aria-hidden="true">
                      {[1, 2, 3, 4].map((n) => <Skull key={n} size={12} data-off={n > LEVEL[d]} />)}
                    </span>
                    <span className="arena-difficulty__hint">{DIFFICULTY_BLURB[d]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>

          {nemesis ? (
            <div className="arena-weak">
              <h3 className="arena-board__title !p-0 !border-0 mb-2">Your weak spots</h3>
              {weak === null ? <p className="arena__sub">Reading your mistakes…</p>
                : weak.concepts.length === 0 ? <p className="arena__sub">No mistakes recorded on this document yet. Take a quiz or review flashcards first.</p>
                : (
                  <ul className="arena-weak__list">
                    {weak.concepts.map((c) => (
                      <li key={c.concept} className="arena-weak__item">
                        <Target size={13} aria-hidden="true" /><span className="arena-weak__name">{c.concept}</span>
                        <span className="arena-weak__misses">{c.misses} missed</span>
                      </li>
                    ))}
                  </ul>
                )}
              {weak && !weak.nemesis_ready && weak.concepts.length > 0 && (
                <p className="arena__sub mt-2">Miss at least 3 different concepts to awaken your Nemesis ({weak.missed_total}/3).</p>
              )}
            </div>
          ) : (
            <Input
              label="Boss topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Photosynthesis, World War II"
              maxLength={200}
              autoComplete="off"
            />
          )}

          {mine && (
            <p className="arena-best">
              <Trophy size={16} aria-hidden="true" />
              <span>Your best</span>
              <Badge tone="reward">{mine.grade}</Badge>
              <span>{mine.accuracy}% in {mmss(mine.time)}</span>
            </p>
          )}

          {entries.length > 0 && (
            <div>
              <h3 className="arena-board__title">Top {Math.min(5, entries.length)}: {DIFFICULTY_LABEL[difficulty]}</h3>
              <ol className="arena-board">
                {entries.slice(0, 5).map((e) => (
                  <li key={`${e.rank}-${e.username}`} className="arena-board__row" data-me={e.is_me ? "true" : undefined}>
                    <span>{e.rank}.</span>
                    <span className="arena-board__name">{e.username}</span>
                    <span className="arena-board__grade pixel-font">{e.grade}</span>
                    <span>{e.accuracy}%</span>
                    <span>{mmss(e.time)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          <Button type="submit" variant="primary" block loading={starting} disabled={!canSummon}>
            {!starting && (difficulty === "nightmare" ? <Skull size={16} aria-hidden="true" /> : <Swords size={16} aria-hidden="true" />)}
            {starting ? "Summoning…" : nemesis ? "Face your Nemesis" : "Summon boss"}
          </Button>
        </form>
      </div>
    </section>
  );
}
