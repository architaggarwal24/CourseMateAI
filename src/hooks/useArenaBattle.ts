"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { ApiError } from "@/lib/api/errors";
import { useHeroStore } from "@/hooks/useHero";
import { useChampion } from "@/hooks/useChampion";
import {
  castSpell, castUltimate, tauntBoss, fetchActiveBattle, fetchBattle, fetchQuestion, forfeitBattle, startBattle, submitAnswer, consumeItem as postItem,
  continueBattle, prepareBattle, rearmBattle,
} from "@/lib/arena/api";
import type {
  Battle, BattleRewards, BossProfile, Difficulty, ItemId, Move, Outcome, Question, Spell,
} from "@/lib/arena/types";

/**
 * The arena's battle state machine (Arena v2: tactical turns). The SERVER decides everything (damage, hearts, the
 * clock, Focus, the boss's intent, rewards); this hook sends the player's choices and keeps what came back.
 *
 *   loading -> summon -> starting -> select -> versus -> fight -> result
 *                          ^                                       |
 *                          +------------- playAgain ---------------+
 *
 * select / versus (Stage 5): the battle exists at once and its questions are written meanwhile (`ready` once they
 * are): the player picks a champion, then faces the boss on the VS screen, and the fight opens when both are done.
 * An expedition's fight skips the pick (the run keeps its champion) and shows the VS screen.
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

export type ArenaPhase = "loading" | "summon" | "starting" | "select" | "versus" | "fight" | "result";
export type ArenaStage = "choosing" | "fetching" | "asking" | "answering" | "feedback" | "failed"
  // Stage 4: knocked down: CONTINUE? (a potion, coins, or give up)
  | "down";
export type SummonMode = "quick" | "nemesis";

/** The server gives a late answer this long (after the clock reaches zero) before it counts the question as missed. */
export const DEADLINE_GRACE_MS = 3000;
/** How long a verdict stays before moving on: short for a right answer, long enough to read the right one after a
 *  miss (hovering or focusing it holds it), and the last one ("over") leaves time for the finisher to play.
 *  Enter or Space moves on at once. */
export const AUTO_ADVANCE_MS = { correct: 1300, wrong: 4500, over: 6000 } as const;
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
  itemBusy: ItemId | Spell | "ultimate" | "taunt" | null;
  /** The ultimate just cast (name and what it did), for the stage and the screen reader; cleared on the next turn. */
  ultimateCast: { name: string; text: string; key: number } | null;
  /** The taunt just thrown (the stage plays it). */
  tauntCast: { key: number; enraged: boolean; meter: number } | null;
  rewards: BattleRewards | null;
  retreated: boolean;
  /** The move picked last turn (Enter or Space picks it again). */
  lastMove: Move | null;
  /** select / versus: the fight's questions are written (the fight can open). */
  ready: boolean;
  /** select / versus: writing them failed (nothing lost; retryPrepare asks again). */
  prepFailed: boolean;
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

/** `documentId`: the document (or course) to fight on when no battle is in progress - the concept map's "Summon its
 *  boss" opens the arena on the map's document. Without it the arena keeps its own last one. */
export function useArenaBattle({ autoResume = true, documentId }: { autoResume?: boolean; documentId?: string } = {}) {
  const [state, setState] = useState<ArenaState>(() => ({
    phase: "loading", stage: "choosing", sessionId: "", battle: null, boss: null, question: null, deadline: null,
    outcome: null, advanceAt: null, stock: { heal: 0, fifty_fifty: 0 }, itemBusy: null, rewards: null, retreated: false,
    ultimateCast: null,
    tauntCast: null,
    lastMove: null,
    ready: false,
    prepFailed: false,
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
      if (e instanceof ApiError && e.code === "knocked_down") {                // down: CONTINUE? first
        try { const r = await fetchBattle(battleId); if (alive.current) patch({ battle: r.battle, stage: "down" }); } catch { patch({ stage: "down" }); }
        return;
      }
      if (e instanceof ApiError && (e.code === "not_enough_focus" || e.code === "invalid_move" || e.code === "move_locked")) {
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
      advanceAt: null, rewards: null, retreated: false, stage: battle.down ? "down" : "choosing",
    });
    // A question already out (refresh mid-question): back to it - its move was chosen and its clock is running.
    if (battle.question_issued) void loadQuestionRef.current(battle.battle_id);
  }, [patch, finish]);

  // ── Stage 5: character select and the VS screen, while the questions are written ─────────────────────────────
  const arming = useRef<Promise<unknown>>(Promise.resolve());
  /** The battle being prepared (a ref, not state: the answer can come back before the screen has re-rendered). */
  const preparing = useRef<string | null>(null);
  /** Write the battle's questions (the server's prepare); `ready` once they are. */
  const prep = useCallback(async (battleId: string) => {
    preparing.current = battleId;
    patch({ ready: false, prepFailed: false });
    try {
      await prepareBattle(battleId);
      if (!alive.current || preparing.current !== battleId) return;
      patch((s) => ({ ready: true, battle: s.battle ? { ...s.battle, prepared: true } : s.battle }));
    } catch (e) {
      if (!alive.current || preparing.current !== battleId) return;
      patch({ prepFailed: true });
      if (!(e instanceof ApiError && e.action === "retry")) toast.apiError(e);
    }
  }, [patch]);
  /** A fresh fight: the champion select (`pick`) or straight to the VS screen, the questions written meanwhile. */
  const preFight = useCallback((battle: Battle, boss: BossProfile, pick: boolean) => {
    rememberSessionId(battle.session_id);
    generation.current++;
    patch({
      phase: pick ? "select" : "versus", sessionId: battle.session_id, battle, boss, question: null, deadline: null, outcome: null,
      advanceAt: null, rewards: null, retreated: false, stage: "choosing", ready: !!battle.prepared, prepFailed: false, lastMove: null,
    });
    arming.current = Promise.resolve();
    if (!battle.prepared) void prep(battle.battle_id);
  }, [patch, prep]);
  /** A battle not yet begun: no answer, no question out, not down. */
  const fresh = (b: Battle) => b.status === "active" && b.answered === 0 && !b.question_issued && !b.down;

  /** Character select: fight as this champion (saved on the account, the battle re-armed for it), then the VS screen. */
  const pickChampion = useCallback((id: string) => {
    const { phase, battle } = latest.current;
    if (phase !== "select" || !battle) return;
    patch({ phase: "versus" });
    if (id === (battle.kit?.champion ?? useChampion.getState().championId)) return;
    arming.current = (async () => {
      try {
        if (!(await useChampion.getState().choose(id))) return;
        const r = await rearmBattle(battle.battle_id);
        if (alive.current && latest.current.battle?.battle_id === battle.battle_id) patch((s) => ({ battle: { ...r.battle, prepared: s.ready || r.battle.prepared } }));
      } catch (e) { toast.apiError(e); }
    })();
  }, [patch]);

  /** The VS screen is done and the questions are ready: open the fight (read fresh: the pick may have re-armed it). */
  const beginFight = useCallback(async () => {
    const { phase, battle, ready } = latest.current;
    if (phase !== "versus" || !battle || !ready) return;
    await arming.current;
    try {
      const r = await fetchBattle(battle.battle_id);
      if (alive.current && latest.current.phase === "versus") enter(r.battle, r.boss);
    } catch (e) {
      if (alive.current) toast.apiError(e, { onRetry: () => { void beginFight(); } });
    }
  }, [enter]);

  const retryPrepare = useCallback(() => {
    const { battle } = latest.current;
    if (battle) void prep(battle.battle_id);
  }, [prep]);

  /** Enter a battle by id (an expedition's fight node). */
  const enterById = useCallback(async (battleId: string) => {
    patch({ phase: "starting" });
    try {
      const r = await fetchBattle(battleId);
      if (!alive.current) return;
      if (fresh(r.battle)) preFight(r.battle, r.boss, false);              // the run keeps its champion: VS, then fight
      else enter(r.battle, r.boss);
    } catch (e) {
      if (!alive.current) return;
      toast.apiError(e, { onRetry: () => { void enterById(battleId); } });
      patch({ phase: "summon" });
    }
  }, [patch, enter, preFight]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Opening the arena: resume the battle in progress, if there is one ─────────────────────────────────────────
  useEffect(() => {
    const summonOn = () => {
      if (documentId) rememberSessionId(documentId);
      return documentId ?? readSessionId();
    };
    if (!autoResume) { patch({ phase: "summon", sessionId: summonOn() }); return; }
    let cancelled = false;
    (async () => {
      try {
        const active = await fetchActiveBattle();
        if (cancelled) return;
        if (active) {
          const boss = active.boss_profile ?? { name: active.boss.name };
          // reopened while its questions were still being written (character select): back to the pick
          if (fresh(active) && !active.prepared && !active.run_id) preFight(active, boss, true);
          else enter(active, boss);
          return;
        }
      } catch (e) {
        if (cancelled) return;
        toast.apiError(e);
      }
      patch({ phase: "summon", sessionId: summonOn() });
    })();
    return () => { cancelled = true; };
  }, [enter, preFight, patch, autoResume, documentId]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const summon = useCallback(async (topic: string, difficulty: Difficulty, mode: SummonMode = "quick", species?: string | null) => {
    const s = latest.current;
    if (s.phase === "starting") return;
    const sessionId = s.sessionId;
    patch({ phase: "starting" });
    try {
      const r = await startBattle(sessionId, topic.trim(), difficulty, mode, species, true);
      if (!alive.current) return;
      if (r.resumed && !fresh(r.battle)) {
        toast.info("You already had this battle running. Picking it back up.");
        enter(r.battle, r.boss);
        return;
      }
      preFight(r.battle, r.boss, true);
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
  }, [patch, enter, preFight]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pick this turn's move: asks the server for a question of the move's tier. */
  const chooseMove = useCallback((move: Move) => {
    const { battle, stage } = latest.current;
    if (!battle || stage !== "choosing") return;
    patch({ lastMove: move });
    void loadQuestion(battle.battle_id, move);
  }, [loadQuestion, patch]);

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
        battle: r.battle, outcome: r, stage: "feedback", deadline: null, ultimateCast: null, tauntCast: null,
        rewards: r.rewards ?? r.battle.rewards ?? null,
        advanceAt: Date.now() + (over ? AUTO_ADVANCE_MS.over : r.correct ? AUTO_ADVANCE_MS.correct : AUTO_ADVANCE_MS.wrong),
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
    else patch({ stage: battle.down ? "down" : "choosing", question: null, advanceAt: null });
  }, [finish, patch]);

  /** Hold the verdict on screen (the player is reading it); `false` lets it move on again shortly. */
  const holdVerdict = useCallback((hold: boolean) => {
    const { stage, advanceAt, battle } = latest.current;
    if (stage !== "feedback") return;
    if (hold && advanceAt !== null) patch({ advanceAt: null });
    // the battle's last verdict waits long enough for the KO (and a finisher) to finish playing
    else if (!hold && advanceAt === null) patch({ advanceAt: Date.now() + (battle && battle.status !== "active" ? AUTO_ADVANCE_MS.over : AUTO_ADVANCE_MS.correct) });
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

  /** Cast the champion's ultimate (meter full): before picking a move, or while a question is open. */
  const ultimate = useCallback(async () => {
    const { battle, stage, itemBusy } = latest.current;
    if (!battle?.kit?.ready || itemBusy || (stage !== "choosing" && stage !== "asking")) return;
    patch({ itemBusy: "ultimate" });
    const gen = generation.current;
    try {
      const r = await castUltimate(battle.battle_id);
      if (!alive.current) return;
      patch((s) => {
        const same = gen === generation.current && !!r.question && !!s.question && r.question.id === s.question.id;
        return {
          battle: r.battle, itemBusy: null, ultimateCast: { name: r.ultimate.name, text: r.ultimate.text, key: Date.now() },
          question: same ? { ...s.question!, ...r.question! } : s.question,
          deadline: same && r.question!.timewarped ? Date.now() + Math.max(0, r.question!.seconds_left) * 1000 : s.deadline,
        };
      });
      toast.success(`${r.ultimate.name}!`);
    } catch (e) {
      if (!alive.current) return;
      patch({ itemBusy: null });
      toast.apiError(e);
    }
  }, [patch]);

  /** Taunt the boss: once a fight, before picking a move or while a question is open. */
  const taunt = useCallback(async () => {
    const { battle, stage, itemBusy } = latest.current;
    if (!battle || battle.taunted || itemBusy || battle.status !== "active" || (stage !== "choosing" && stage !== "asking")) return;
    patch({ itemBusy: "taunt" });
    try {
      const r = await tauntBoss(battle.battle_id);
      if (!alive.current) return;
      patch({ battle: r.battle, itemBusy: null, tauntCast: { key: Date.now(), enraged: r.taunt.enraged, meter: r.taunt.meter_gain } });
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

  /** CONTINUE after a knock-down: back on your feet with full hearts (a potion, or coins). */
  const continueWith = useCallback(async (by: "potion" | "coins") => {
    const { battle } = latest.current;
    if (!battle || latest.current.stage !== "down") return false;
    try {
      const r = await continueBattle(battle.battle_id, by);
      if (!alive.current) return false;
      patch({ battle: r.battle, stock: r.stock, stage: "choosing", outcome: null, question: null });
      refreshGame();
      return true;
    } catch (e) {
      if (!alive.current) return false;
      if (e instanceof ApiError && (e.code === "battle_finished" || e.code === "not_down")) { void settleDown(); return false; }
      toast.apiError(e);
      return false;
    }
  }, [patch]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The CONTINUE countdown ran out (or the server says so): read the battle; a lost one goes to the result. */
  const settleDown = useCallback(async () => {
    const { battle } = latest.current;
    if (!battle) return;
    try {
      const r = await fetchBattle(battle.battle_id);
      if (!alive.current) return;
      if (r.battle.status !== "active") finish(r.battle, r.battle.rewards ?? null);
      else patch({ battle: r.battle, stage: r.battle.down ? "down" : "choosing" });
    } catch (e) { if (alive.current) toast.apiError(e); }
  }, [finish, patch]);

  /** Back to the summon screen (same document). */
  const playAgain = useCallback(() => {
    generation.current++;
    patch({ phase: "summon", battle: null, boss: null, question: null, deadline: null, outcome: null, advanceAt: null, rewards: null, retreated: false });
  }, [patch]);

  return { ...state, summon, chooseMove, answer, next, holdVerdict, retryQuestion, applyItem, cast, ultimate, taunt, retreat, playAgain, enterById, continueWith, settleDown,
    pickChampion, beginFight, retryPrepare };
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
