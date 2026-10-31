"use client";

import { useEffect, useState } from "react";
import { useArenaBattle } from "@/hooks/useArenaBattle";
import { fetchRun } from "@/lib/arena/api";
import type { Run } from "@/lib/arena/types";
import ArenaHub, { type ArenaMode } from "./ArenaHub";
import BattleScreen from "./BattleScreen";
import ResultPanel from "./ResultPanel";
import RunScreen, { RunStatusBar } from "./RunScreen";
import SummonPanel from "./SummonPanel";
import "./arena.css";
import "./arena-v2.css";
import "./pixel/pixel.css";

/**
 * The Arena tab of the Hero area (the Hero layout provides the Play theme). Opens on the battle already in progress,
 * if there is one; otherwise on the hub: Quick Battle, Nemesis, Expedition (Multiplayer: coming soon).
 * Every fight is decided by the server (hooks/useArenaBattle); an expedition's map lives in RunScreen.
 */
export default function ArenaArea() {
  const arena = useArenaBattle();
  const [mode, setMode] = useState<ArenaMode | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const runId = arena.battle?.run_id ?? null;

  // A battle that belongs to an expedition shows the run's status above it.
  useEffect(() => {
    if (!runId) { setRun(null); return; }
    let alive = true;
    fetchRun(runId).then((r) => alive && setRun(r)).catch(() => {});
    return () => { alive = false; };
  }, [runId, arena.phase]);

  if (arena.phase === "loading") return <p className="arena__status" role="status">Looking for your battle…</p>;

  if (arena.phase === "result" && arena.battle) {
    const inRun = !!arena.battle.run_id;
    return (
      <div className="arena">
        {inRun && run && <RunStatusBar run={run} />}
        <ResultPanel
          battle={arena.battle} rewards={arena.rewards} retreated={arena.retreated}
          bossName={arena.boss?.name ?? arena.battle.boss.name}
          onAgain={() => { arena.playAgain(); setMode(inRun ? "run" : mode ?? "quick"); }}
          againLabel={inRun ? (arena.battle.status === "won" ? "Back to the map" : "See the expedition's end") : undefined}
        />
      </div>
    );
  }

  if (arena.phase === "fight") {
    return <BattleScreen arena={arena} context={runId && run ? <RunStatusBar run={run} /> : undefined} />;
  }

  // The map stays mounted while a fight is being opened, so a failed open lands back on it (no remount, no retry loop).
  if (mode === "run") {
    return (
      <>
        {arena.phase === "starting" && <p className="arena__status" role="status">Entering the fight…</p>}
        <RunScreen sessionId={arena.sessionId} onBattle={(id) => void arena.enterById(id)} onBack={() => setMode(null)} />
      </>
    );
  }

  if (mode === "quick" || mode === "nemesis") {
    return (
      <div className="arena">
        <SummonPanel sessionId={arena.sessionId} starting={arena.phase === "starting"} onSummon={arena.summon} mode={mode} onBack={() => setMode(null)} />
      </div>
    );
  }

  return <ArenaHub sessionId={arena.sessionId} onPick={setMode} />;
}
