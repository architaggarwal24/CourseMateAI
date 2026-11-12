"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useArenaBattle } from "@/hooks/useArenaBattle";
import { useSessionStore } from "@/hooks/useSessions";
import { fetchRun } from "@/lib/arena/api";
import type { Run } from "@/lib/arena/types";
import ArenaHub, { type ArenaMode } from "./ArenaHub";
import BattleScreen from "./BattleScreen";
import CharacterSelect from "./CharacterSelect";
import ResultPanel from "./ResultPanel";
import RunScreen, { RunStatusBar } from "./RunScreen";
import SummonPanel from "./SummonPanel";
import VersusScreen from "./VersusScreen";
import "./arena.css";
import "./arena-v2.css";
import "./fight.css";
import "./pixel/pixel.css";

/**
 * The Arena tab of the Hero area (the Hero layout provides the Play theme). Opens on the battle already in progress,
 * if there is one; otherwise on the hub: Quick Battle, Nemesis, Expedition (Multiplayer: coming soon).
 * Every fight is decided by the server (hooks/useArenaBattle); an expedition's map lives in RunScreen.
 */
export default function ArenaArea() {
  // ?doc=&topic= (the concept map's "Summon its boss"): a Quick Battle on that document with the topic filled in.
  const params = useSearchParams();
  const docParam = params?.get("doc") || undefined;
  const topicParam = params?.get("topic") || undefined;
  // ?hunt=<species> (the Bestiary's Hunt button): a Quick Battle against that creature
  const huntParam = params?.get("hunt") || undefined;
  const [hunt, setHunt] = useState<string | null>(huntParam ?? null);
  const arena = useArenaBattle({ documentId: docParam });
  const [mode, setMode] = useState<ArenaMode | null>(topicParam || huntParam ? "quick" : null);
  // A course from the map isn't in the document list: fetch its record so the uploader names it.
  const refreshDocument = useSessionStore((s) => s.refreshDocument);
  useEffect(() => { if (docParam) refreshDocument(docParam).catch(() => {}); }, [docParam, refreshDocument]);
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

  // Stage 5: pick a champion, then VS, while the fight's questions are written
  if (arena.phase === "select" && arena.battle) {
    return (
      <div className="arena">
        <CharacterSelect ready={arena.ready} failed={arena.prepFailed} onPick={arena.pickChampion} onRetry={arena.retryPrepare} />
      </div>
    );
  }
  if (arena.phase === "versus" && arena.battle) {
    return (
      <div className="arena">
        {runId && run && <RunStatusBar run={run} />}
        <VersusScreen key={arena.battle.battle_id} battle={arena.battle} ready={arena.ready} failed={arena.prepFailed}
          onBegin={() => void arena.beginFight()} onRetry={arena.retryPrepare} />
      </div>
    );
  }

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
        <SummonPanel sessionId={arena.sessionId} starting={arena.phase === "starting"} mode={mode} onBack={() => setMode(null)}
          onSummon={(topic, difficulty, m) => arena.summon(topic, difficulty, m, m === "quick" ? hunt : null)}
          initialTopic={mode === "quick" ? topicParam : undefined}
          hunt={mode === "quick" ? hunt : null} onCancelHunt={() => setHunt(null)} />
      </div>
    );
  }

  return <ArenaHub sessionId={arena.sessionId} onPick={setMode} />;
}
