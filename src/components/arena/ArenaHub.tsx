"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Lock, Map as MapIcon, Swords, Target, Users } from "lucide-react";
import { Badge } from "@/components/ui";
import { TiltCard } from "@/components/fx";
import { fetchActiveRun, fetchLeaderboard, fetchWeakConcepts } from "@/lib/arena/api";
import { DIFFICULTY_LABEL, type LeaderboardEntry, type Run, type WeakConceptsResponse } from "@/lib/arena/types";
import { Bestiary } from "./pixel/Bestiary";
import { Roster } from "./pixel/Roster";

export type ArenaMode = "quick" | "nemesis" | "run";

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;

/**
 * The arena's front door: four modes as cards (Quick Battle, Nemesis, Expedition, and Multiplayer - coming soon),
 * with what each needs or holds (an expedition in progress, the weak spots that feed the Nemesis), and this week's
 * board across every topic.
 */
export default function ArenaHub({ sessionId, onPick }: { sessionId: string; onPick: (m: ArenaMode) => void }) {
  const [weak, setWeak] = useState<WeakConceptsResponse | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    let alive = true;
    if (sessionId) {
      fetchWeakConcepts(sessionId).then((r) => alive && setWeak(r)).catch(() => {});
      fetchActiveRun(sessionId).then((r) => alive && setRun(r)).catch(() => {});
    }
    fetchLeaderboard("", "medium", undefined, "global").then((r) => alive && setBoard(r.entries ?? [])).catch(() => {});
    return () => { alive = false; };
  }, [sessionId]);

  const modes = [
    { id: "quick" as const, title: "Quick Battle", Icon: Swords, tone: "accent", blurb: "One boss on any topic from your document. Pick your moves, read its intent, win the duel.",
      chip: "Tactical turns" },
    { id: "nemesis" as const, title: "Nemesis", Icon: Target, tone: "epic", blurb: "A boss made of the concepts you keep missing. Beat it and they stop being weak spots.",
      chip: weak ? (weak.nemesis_ready ? `${weak.concepts.length} weak spots` : `${weak.missed_total}/3 missed`) : "Mistake-driven",
      locked: weak ? !weak.nemesis_ready : false },
    { id: "run" as const, title: "Expedition", Icon: MapIcon, tone: "reward", blurb: "A roguelite run through your document: three acts, branching paths, relics, one life.",
      chip: run ? `In progress · Act ${run.act}` : "Roguelite" },
  ];

  return (
    <div className="arena arena-hub">
      <div className="arena-hub__head">
        <h2 className="arena__title text-gradient-accent">Battle Arena</h2>
        <p className="arena__sub">Turn what you studied into fights. Choose how you want to play.</p>
      </div>

      <ul className="arena-hub__modes">
        {modes.map((m, i) => (
          <motion.li key={m.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, type: "spring", stiffness: 260, damping: 24 }}>
            <TiltCard className="arena-mode" data-tone={m.tone} max={7}>
              <button type="button" className="arena-mode__btn" onClick={() => onPick(m.id)} aria-describedby={`mode-${m.id}`}>
                <span className="arena-mode__icon" aria-hidden="true"><m.Icon size={26} /></span>
                <span className="arena-mode__title">{m.title}</span>
                <span id={`mode-${m.id}`} className="arena-mode__blurb">{m.blurb}</span>
                <Badge tone={m.locked ? "neutral" : m.id === "run" && run ? "reward" : "accent"}>{m.locked && <Lock size={10} aria-hidden="true" />}{m.chip}</Badge>
              </button>
            </TiltCard>
          </motion.li>
        ))}
        <motion.li initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.21 }}>
          <div className="arena-mode arena-mode--soon" aria-disabled="true">
            <div className="arena-mode__btn">
              <span className="arena-mode__icon" aria-hidden="true"><Users size={26} /></span>
              <span className="arena-mode__title">Multiplayer</span>
              <span className="arena-mode__blurb">Duel a friend on the same document, or raid a boss together.</span>
              <Badge><Lock size={10} aria-hidden="true" />Coming soon</Badge>
            </div>
          </div>
        </motion.li>
      </ul>

      <Roster />

      {board.length > 0 && (
        <section className="arena-hub__board glass" aria-label="This week's leaderboard">
          <h3 className="arena-board__title">This week · {DIFFICULTY_LABEL.medium} · every topic</h3>
          <ol className="arena-board !border-0 !bg-transparent">
            {board.slice(0, 5).map((e) => (
              <li key={`${e.rank}-${e.username}`} className="arena-board__row" data-me={e.is_me ? "true" : undefined}>
                <span>{e.rank}.</span><span className="arena-board__name">{e.username}{e.topic ? <span className="text-fg-muted"> · {e.topic}</span> : null}</span>
                <span className="arena-board__grade pixel-font">{e.grade}</span><span>{e.accuracy}%</span><span>{mmss(e.time)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Bestiary />
    </div>
  );
}
