"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Crown, Gauge, HeartPulse, Lock, Map as MapIcon, Swords, Target } from "@/components/ui/icons";
import { Badge } from "@/components/ui";
import { fetchActiveRun, fetchLeaderboard, fetchPower, fetchWeakConcepts } from "@/lib/arena/api";
import { DIFFICULTY_LABEL, type LeaderboardEntry, type PowerOverview, type Run, type WeakConceptsResponse } from "@/lib/arena/types";
import { Roster } from "./pixel/Roster";
import SeasonBanner from "@/components/play/SeasonBanner";

export type ArenaMode = "quick" | "nemesis" | "run" | "rush" | "survival";

const mmss = (seconds: number) => `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;

/**
 * The arena's front door: the modes as cards (Quick Battle, Nemesis, Expedition, Boss Rush, Survival) with what each
 * needs or holds (an expedition in progress, the weak spots that feed the Nemesis, the hunts that open Boss Rush, your
 * bests), your power level (Stage 6: the bosses of Boss Rush and Survival are matched to it), and this week's board.
 */
export default function ArenaHub({ sessionId, onPick, onSeason, starting }: { sessionId: string; onPick: (m: ArenaMode) => void; onSeason?: () => void; starting?: boolean }) {
  const [weak, setWeak] = useState<WeakConceptsResponse | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [power, setPower] = useState<PowerOverview | null>(null);

  useEffect(() => {
    let alive = true;
    if (sessionId) {
      fetchWeakConcepts(sessionId).then((r) => alive && setWeak(r)).catch(() => {});
      fetchActiveRun(sessionId).then((r) => alive && setRun(r)).catch(() => {});
    }
    fetchPower(sessionId || undefined).then((r) => alive && setPower(r)).catch(() => {});
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
    { id: "rush" as const, title: "Boss Rush", Icon: Crown, tone: "epic", blurb: "Your three strongest hunted creatures in a row. Hearts carry over. Clear all three for the big chest.",
      chip: power ? (power.rush.unlocked ? (power.rush.wins ? `Cleared ${power.rush.wins}x` : "3 bosses") : `${power.rush.hunted}/${power.rush.need} hunted`) : "3 bosses",
      locked: power ? !power.rush.unlocked : false },
    { id: "survival" as const, title: "Survival", Icon: HeartPulse, tone: "accent", blurb: "Boss after boss matched to your power, each stronger. A chest every 5. How far can you go?",
      chip: power?.survival.best ? `Best: ${power.survival.best.stage} bosses` : "Endless" },
  ];

  return (
    <div className="arena arena-hub">
      <div className="arena-hub__head">
        <h2 className="arena__title">Battle Arena</h2>
        <p className="arena__sub">Turn what you studied into fights. Choose how you want to play.</p>
        {power && (
          <p className="arena-hub__power" title={`${power.power.from_score} from your best scores, ${power.power.from_hunts} from ${power.power.hunted.length} creatures hunted`}>
            <Gauge size={16} aria-hidden="true" /><span>Power level</span><span className="pixel-font">{power.power.power}</span>
          </p>
        )}
      </div>

      {onSeason && <SeasonBanner sessionId={sessionId || null} onFace={onSeason} starting={starting} />}

      <ul className="arena-hub__modes">
        {modes.map((m, i) => (
          <motion.li key={m.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, type: "spring", stiffness: 260, damping: 24 }}>
            <div className="arena-mode" data-tone={m.tone}>
              <button type="button" className="arena-mode__btn" onClick={() => onPick(m.id)} aria-describedby={`mode-${m.id}`}>
                <span className="arena-mode__icon" aria-hidden="true"><m.Icon size={26} /></span>
                <span className="arena-mode__title">{m.title}</span>
                <span id={`mode-${m.id}`} className="arena-mode__blurb">{m.blurb}</span>
                <Badge tone={m.locked ? "neutral" : m.id === "run" && run ? "reward" : "accent"}>{m.locked && <Lock size={10} aria-hidden="true" />}{m.chip}</Badge>
              </button>
            </div>
          </motion.li>
        ))}
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
    </div>
  );
}
