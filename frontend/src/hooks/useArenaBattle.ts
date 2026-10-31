"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/errors";
import { useHeroStore } from "@/hooks/useHero";
import {
  castSpell, fetchActiveBattle, fetchBattle, fetchQuestion, forfeitBattle, startBattle, submitAnswer, consumeItem as postItem,
} from "@/lib/arena/api";
import type {
  Battle, BattleRewards, BossProfile, Difficulty, ItemId, Move, Outcome, Question, Spell,
} from "@/lib/arena/types";

/**
 * The arena's battle state machine (Arena v2: tactical turns). The SERVER decides everything (damage, hearts, the
 * clock, Focus, the boss's intent, rewards); this hook sends the player's choices and keeps what came back.
 *
 *   loading -> summon -> starting -> fight -> result
 *                          ^                     |
 *                          +---- playAgain ------+
 *
 * Inside `fight` a turn goes through these stages:
 *   choosing   the boss's intent is shown; the player picks a move (strike / jab / heavy / guard)
 *   fetching   waiting for the question that move asks for
 *   asking     the question is on screen and its clock is running (spells and items work here)
 *   answering  a pick was sent, the verdict is on its way
 *   feedback   the verdict is on screen. It moves on by itself (a right answer quickly, a wrong one after time to
 *              read the explanation) - or at once with Continue / Enter. Then: choosing, or the result.
 *   failed     the questions could not be generated: nothing was lost, Retry asks again
 *
 * Opening the arena asks the server for the battle in progress, so a refresh, a new tab or a restart resumes it.
 */

export type ArenaPhase = "loading" | "summon" | "starting" | "fight" | "result";
export type ArenaStage = "choosing" | "fetching" | "asking" | "answering" | "feedback" | "failed";
export type SummonMode = "quick" | "nemesis";

/** The server gives a late answer this long (after the clock reaches zero) before it counts the question as missed. */
export const DEADLINE_GRACE_MS = 3000;
/** How long a verdict stays before the next turn: short for a right answer, long enough to read for a wrong one. */
export const AUTO_ADVANCE_MS = { correct: 1800, wrong: 6000 } as const;
const SESSION_KEY = "cmai_arena_session";

export interface ArenaState {
  phase: ArenaPhase;
  stage: ArenaStage;
  /** The document the next battle is fought on. */
  sessionId: string;
  battle: Battle | null;
  boss: BossProfile | null;
  question: Question | null;
  /** When the question's clock runs out (ms since epoch), from the server's seconds_left. */
  deadline: number | null;
  /** The verdict on the last answer (stage "feedback"), or a question that timed out while the player was away. */
  outcome: Outcome | null;
  /** When the verdict on screen moves on by itself (ms since epoch); null = it waits (paused). */
  advanceAt: number | null;
  stock: { heal: number; fifty_fifty: number };
  itemBusy: ItemId | Spell | null;
  rewards: BattleRewards | null;
  retreated: boolean;
}

function readSessionId(): string {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

function rememberSessionId(id: string) {
  try { sessionStorage.setItem(SESSION_KEY, id); } catch { /* private mode: the id lives in state */ }
}

const refreshGame = () => { void useHeroStore.getState().reconcile(); };

export function useArenaBattle({ autoResume = true }: { autoResume?: boolean } = {}) {
  const [state, setState] = useState<ArenaState>(() => ({
    phase: "loading", stage: "choosing", sessionId: "", battle: null, boss: null, question: null, deadline: null,
    outcome: null, advanceAt: null, stock: { heal: 0, fifty_fifty: 0 }, itemBusy: null, rewards: null, retreated: false,
  }));
  const patch = useCallback((p: Partial<ArenaState> | ((s: ArenaState) => Partial<ArenaState>)) => {
    setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) }));
  }, []);

  const alive = useRef(true);
  const latest = useRef(state);
  latest.current = state;
  /** Bumped by every question request / screen change, so an answer that arrives after the player moved on is dropped. */
  const generation = useRef(0);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** The fight is over (won / lost): show the result, and re-read coins / XP / items the rewards touched. */
  const finish = useCallback((battle: Battle, rewards: BattleRewards | null, retreated = false) => {
    generation.current++;
    patch({ phase: "result", battle, rewards: rewards ?? battle.rewards ?? null, question: null, deadline: null, advanceAt: null, retreated });
    refreshGame();
  }, [patch]);

  const loadQuestionRef = useRef<(battleId: string, move?: Move) => Promise<void>>(async () => {});
  const loadQuestion = useCallback(async (battleId: string, move?: Move) => {
    const gen = ++generation.current;
    patch({ stage: "fetching", advanceAt: null });
    try {
      const r = await fetchQuestion(battleId, move);
      if (!alive.current || gen !== generation.current) return;
      if (r.battle.status !== "active" || !r.question) {
        finish(r.battle, r.battle.rewards ?? null);
        return;
      }
      patch((s) => ({
        battle: r.battle, question: r.question, stage: "asking", outcome: r.previous ?? null,
        deadline: Date.now() + Math.max(0, r.question!.seconds_left) * 1000,
        stock: r.stock ?? s.stock,
      }));
      if (r.previous) refreshGame();
    } catch (e) {
      if (!alive.current || gen !== generation.current) return;
      if (e instanceof ApiError && (e.code === "not_enough_focus" || e.code === "invalid_move")) {
        patch({ stage: "choosing" });                                     // a refused move: pick another
        toast.apiError(e);
        return;
      }
      patch({ stage: "failed" });
      if (!(e instanceof ApiError && e.action === "retry")) toast.apiError(e, { onRetry: () => { void loadQuestion(battleId, move); } });
    }
  }, [patch, finish]);
  loadQuestionRef.current = loadQuestion;

  /** Enter a battle that exists on the server (new or resumed): the first turn starts at the move choice. */
  const enter = useCallback((battle: Battle, boss: BossProfile) => {
    rememberSessionId(battle.session_id);
    generation.current++;
    if (battle.status !== "active") {
      patch({ sessionId: battle.session_id, boss });
      finish(battle, battle.rewards ?? null);
      return;
    }
    patch({
      phase: "fight", sessionId: battle.session_id, battle, boss, question: null, deadline: null, outcome: null,
      advanceAt: null, rewards: null, retreated: false, stage: "choosing",
    });
    // A question already out (refresh mid-question): back to it - its move was chosen and its clock is running.
    if (battle.question_issued) void loadQuestionRef.current(battle.battle_id);
  }, [patch, finish]);

  /** Enter a battle by id (an expedition's fight node). */
  const enterById = useCallback(async (battleId: string) => {
    patch({ phase: "starting" });
    try {
      const r = await fetchBattle(battleId);
      if (alive.current) enter(r.battle, r.boss);
    } catch (e) {
      if (!alive.current) return;
      toast.apiError(e, { onRetry: () => { void enterById(battleId); } });
      patch({ phase: "summon" });
    }
  }, [patch, enter]);

  // ── Opening the arena: resume the battle in progress, if there is one ─────────────────────────────────────────
  useEffect(() => {
    if (!autoResume) { patch({ phase: "summon", sessionId: readSessionId() }); return; }
    let cancelled = false;
    (async () => {
      try {
        const active = await fetchActiveBattle();
        if (cancelled) return;
        if (active) { enter(active, active.boss_profile ?? { name: active.boss.name }); return; }
      } catch (e) {
        if (cancelled) return;
        toast.apiError(e);
      }
      patch({ phase: "summon", sessionId: readSessionId() });
    })();
    return () => { cancelled = true; };
  }, [enter, patch, autoResume]);

  // ── The clock ran out: wait out the server's grace, then read the battle (the server settles the miss on read) and
  //    go to the next move choice. Nothing new is issued, so no Focus is spent on a move the player didn't pick. ─────
  const settleTimeout = useCallback(async (battleId: string) => {
    const gen = ++generation.current;
    const before = latest.current.battle;
    const timedOut = latest.current.question;
    try {
      const r = await fetchBattle(battleId);
      if (!alive.current || gen !== generation.current) return;
      if (r.battle.status !== "active") { finish(r.battle, r.battle.rewards ?? null); return; }
      const taken = Math.max(0, (before?.player.hp ?? r.battle.player.hp) - r.battle.player.hp);
      patch({
        battle: r.battle, question: null, deadline: null, stage: "choosing", advanceAt: null,
        outcome: {
          question_id: timedOut?.id ?? -1, correct: false, timed_out: true, answer: null, correct_answer: "",
          damage_dealt: 0, damage_taken: taken, combo: 0,
        },
      });
      refreshGame();
    } catch {
      if (!alive.current || gen !== generation.current) return;
      void loadQuestion(battleId);                                         // fall back: the question endpoint settles it too
    }
  }, [patch, finish, loadQuestion]);

  useEffect(() => {
    if (state.phase !== "fight" || state.stage !== "asking" || state.deadline === null || !state.battle) return;
    const battleId = state.battle.battle_id;
    const wait = Math.max(0, state.deadline + DEADLINE_GRACE_MS + 400 - Date.now());
    const timer = setTimeout(() => { void settleTimeout(battleId); }, wait);
    return () => clearTimeout(timer);
  }, [state.phase, state.stage, state.deadline, state.battle?.battle_id, settleTimeout]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Actions ───────────────────────────────────────────────────────────────────────────────────────────────────
  const summon = useCallback(async (topic: string, difficulty: Difficulty, mode: SummonMode = "quick") => {
    const s = latest.current;
    if (s.phase === "starting") return;
    const sessionId = s.sessionId;
    patch({ phase: "starting" });
    try {
      const r = await startBattle(sessionId, topic.trim(), difficulty, mode);
      if (!alive.current) return;
      if (r.resumed) toast.info("You already had this battle running. Picking it back up.");
      enter(r.battle, r.boss);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.code === "battle_in_progress") {
        toast.info("You already have a battle on this document. Picking it back up.");
        try {
          const active = await fetchActiveBattle(sessionId);
          if (alive.current && active) { enter(active, active.boss_profile ?? { name: active.boss.name }); return; }
        } catch { /* fall through to the summon screen */ }
      } else {
        toast.apiError(e, { onRetry: () => { void summon(topic, difficulty, mode); } });
      }
      patch({ phase: "summon" });
    }
  }, [patch, enter]);

  /** Pick this turn's move: asks the server for a question of the move's tier. */
  const chooseMove = useCallback((move: Move) => {
    const { battle, stage } = latest.current;
    if (!battle || stage !== "choosing") return;
    void loadQuestion(battle.battle_id, move);
  }, [loadQuestion]);

  const answer = useCallback(async (option: string) => {
    const { battle, question, stage, deadline } = latest.current;
    if (!battle || !question || stage !== "asking") return;
    if (deadline !== null && Date.now() > deadline) return;               // the clock is out: the miss is settled by the server
    const gen = ++generation.current;
    patch({ stage: "answering" });
    try {
      const r = await submitAnswer(battle.battle_id, question.id, option);
      if (!alive.current || gen !== generation.current) return;
      const over = r.battle.status !== "active";
      patch({
        battle: r.battle, outcome: r, stage: "feedback", deadline: null,
        rewards: r.rewards ?? r.battle.rewards ?? null,
        advanceAt: Date.now() + (r.correct && !over ? AUTO_ADVANCE_MS.correct : AUTO_ADVANCE_MS.wrong),
      });
      if (over) refreshGame();
    } catch (e) {
      if (!alive.current || gen !== generation.current) return;
      if (e instanceof ApiError && (e.code === "question_not_current" || e.code === "battle_finished")) {
        void loadQuestion(battle.battle_id);                                // out of step with the server: ask where we are
        return;
      }
      patch({ stage: "asking" });
      toast.apiError(e, { onRetry: () => { void answer(option); } });
    }
  }, [patch, loadQuestion]);

  /** From the verdict: the next turn's move choice, or - when that answer ended the battle - the result. */
  const next = useCallback(() => {
    const { battle, stage } = latest.current;
    if (!battle || stage !== "feedback") return;
    if (battle.status !== "active") finish(battle, latest.current.rewards);
    else patch({ stage: "choosing", question: null, advanceAt: null });
  }, [finish, patch]);

  /** Hold the verdict on screen (the player is reading it); `false` lets it move on again shortly. */
  const holdVerdict = useCallback((hold: boolean) => {
    const { stage, advanceAt } = latest.current;
    if (stage !== "feedback") return;
    if (hold && advanceAt !== null) patch({ advanceAt: null });
    else if (!hold && advanceAt === null) patch({ advanceAt: Date.now() + AUTO_ADVANCE_MS.correct });
  }, [patch]);

  // ── The verdict moves on by itself ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.stage !== "feedback" || state.advanceAt === null) return;
    const timer = setTimeout(next, Math.max(0, state.advanceAt - Date.now()));
    return () => clearTimeout(timer);
  }, [state.stage, state.advanceAt, next]);

  const retryQuestion = useCallback(() => {
    const { battle } = latest.current;
    if (battle) patch({ stage: "choosing" });
  }, [patch]);

  const applyItem = useCallback(async (item: ItemId) => {
    const { battle, stage, itemBusy } = latest.current;
    if (!battle || stage !== "asking" || itemBusy) return;
    patch({ itemBusy: item });
    const gen = generation.current;
    try {
      const r = await postItem(battle.battle_id, item);
      if (!alive.current) return;
      if (gen !== generation.current) { patch({ itemBusy: null, stock: r.stock }); return; }   // the turn moved on meanwhile
      patch((s) => ({
        battle: r.battle, stock: r.stock, itemBusy: null,
        question: r.question && s.question && r.question.id === s.question.id ? { ...s.question, ...r.question } : s.question,
      }));
      toast.success(item === "heal" ? "Healed +1 heart." : "Two wrong answers removed.");
      refreshGame();
    } catch (e) {
      if (!alive.current) return;
      patch({ itemBusy: null });
      // The server's refusals (no stock, hearts already full, ...) are final: no Retry button for those.
      const refused = e instanceof ApiError && e.status === 409;
      toast.apiError(e, refused ? undefined : { onRetry: () => { void applyItem(item); } });
    }
  }, [patch]);

  /** Cast a spell on the open question (costs Focus): insight removes two wrong options, timewarp adds 15 seconds. */
  const cast = useCallback(async (spell: Spell) => {
    const { battle, stage, itemBusy } = latest.current;
    if (!battle || stage !== "asking" || itemBusy) return;
    patch({ itemBusy: spell });
    const gen = generation.current;
    try {
      const r = await castSpell(battle.battle_id, spell);
      if (!alive.current) return;
      if (gen !== generation.current) { patch({ itemBusy: null }); return; }        // the turn moved on meanwhile
      patch((s) => {
        const same = !!r.question && !!s.question && r.question.id === s.question.id;
        return {
          battle: r.battle, itemBusy: null,
          question: same ? { ...s.question!, ...r.question! } : s.question,
          deadline: same && spell === "timewarp" ? Date.now() + Math.max(0, r.question!.seconds_left) * 1000 : s.deadline,
        };
      });
    } catch (e) {
      if (!alive.current) return;
      patch({ itemBusy: null });
      toast.apiError(e);
    }
  }, [patch]);

  const retreat = useCallback(async () => {
    const { battle } = latest.current;
    if (!battle) return;
    try {
      const r = await forfeitBattle(battle.battle_id);
      if (!alive.current) return;
      finish(r.battle, r.rewards, true);
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.code === "battle_finished") { void loadQuestion(battle.battle_id); return; }
      toast.apiError(e, { onRetry: () => { void retreat(); } });
    }
  }, [finish, loadQuestion]);

  /** Back to the summon screen (same document). */
  const playAgain = useCallback(() => {
    generation.current++;
    patch({ phase: "summon", battle: null, boss: null, question: null, deadline: null, outcome: null, advanceAt: null, rewards: null, retreated: false });
  }, [patch]);

  return { ...state, summon, chooseMove, answer, next, holdVerdict, retryQuestion, applyItem, cast, retreat, playAgain, enterById };
}

/** Whole seconds left until `deadline` (ms since epoch); null when there is no clock. Ticks four times a second. */
export function useSecondsLeft(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}
