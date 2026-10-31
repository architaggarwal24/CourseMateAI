"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Brain, ChevronRight, Flag, FlaskConical, Hourglass, Scissors, ShieldCheck, Zap } from "lucide-react";
import { GearChips } from "@/components/avatar";
import { Badge, Button, Modal } from "@/components/ui";
import { type useArenaBattle } from "@/hooks/useArenaBattle";
import { shortcutBlocked } from "@/lib/keys";
import { DIFFICULTY_LABEL, MOVE_INFO, type Battle, type Outcome } from "@/lib/arena/types";
import { bossById } from "@/lib/pixel/bosses";
import type { Beat, IntentTint } from "@/lib/pixel/fight";
import FocusPips from "./FocusPips";
import Hearts from "./Hearts";
import Intent from "./Intent";
import MovePicker from "./MovePicker";
import PixelArena, { type Floater } from "./pixel/PixelArena";
import PixelSprite from "./pixel/PixelSprite";
import { useFighter } from "./pixel/useFighter";
import TimerRing from "./TimerRing";

type Arena = ReturnType<typeof useArenaBattle>;

/** True once `deadline` has passed (one timer, not a tick: the screen re-renders once, when the clock runs out). */
function useExpired(deadline: number | null): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (deadline === null) { setExpired(false); return; }
    const left = deadline - Date.now();
    setExpired(left <= 0);
    if (left <= 0) return;
    const t = setTimeout(() => setExpired(true), left);
    return () => clearTimeout(t);
  }, [deadline]);
  return expired;
}

/** Damage numbers (and blocks, heals, shields) for the last answer: they float up, then are cleared. */
function useFloaters(outcome: Arena["outcome"], show: boolean): Floater[] {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const id = outcome?.question_id;
  useEffect(() => {
    if (!show || !outcome) { setFloaters([]); return; }
    const next: Floater[] = [];
    if (outcome.damage_dealt > 0) {
      next.push({ id: `d${id}`, side: "boss", text: `-${outcome.damage_dealt}`, kind: outcome.weakness ? "crit" : "hit", sub: outcome.weakness ? "Weakness!" : outcome.move === "heavy" ? "Heavy!" : undefined });
      if ((outcome.pet_strike ?? 0) > 0) next.push({ id: `p${id}`, side: "boss", text: `+${outcome.pet_strike}`, kind: "pet", sub: "Pet strike" });
    }
    if ((outcome.shield_absorbed ?? 0) > 0) next.push({ id: `s${id}`, side: "boss", text: `${outcome.shield_absorbed}`, kind: "shield", sub: "Shielded" });
    if ((outcome.boss_healed ?? 0) > 0) next.push({ id: `bh${id}`, side: "boss", text: `+${outcome.boss_healed}`, kind: "heal", sub: "Boss healed" });
    if (outcome.blocked || outcome.aegis) next.push({ id: `b${id}`, side: "hero", text: "Blocked", kind: "block" });
    if (outcome.damage_taken > 0) next.push({ id: `t${id}`, side: "hero", text: `-${outcome.damage_taken}`, kind: "hurt" });
    if ((outcome.focus_gained ?? 0) > 0) next.push({ id: `f${id}`, side: "hero", text: `+${outcome.focus_gained}`, kind: "focus", sub: "Focus" });
    setFloaters(next);
    const timer = setTimeout(() => setFloaters([]), 1600);
    return () => clearTimeout(timer);
  }, [id, show]); // eslint-disable-line react-hooks/exhaustive-deps
  return floaters;
}

/** Waiting for a question. The first batch of a fight is written by the LLM from the PDF and can take a while on a
 *  slow model, so the wait says what is happening and how long it has been (instead of a spinner that looks stuck). */
const FORGE_STEPS = [
  { at: 0, text: "The beast circles you…" },
  { at: 4, text: "Reading your document for questions…" },
  { at: 15, text: "Forging questions from what you studied…" },
  { at: 35, text: "Slow model today - still forging…" },
  { at: 70, text: "Almost there. If this fails, nothing is lost." },
];
function ForgingWait({ first }: { first: boolean }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const step = first ? [...FORGE_STEPS].reverse().find((s) => secs >= s.at)! : { text: "The boss is choosing its next question…" };
  return (
    <div className="arena-wait" role="status" aria-live="polite">
      <span className="arena-wait__orb" aria-hidden="true" />
      <span>{step.text}</span>
      {first && secs >= 4 && <span className="arena-wait__secs pixel-font" aria-hidden="true">{secs}s</span>}
    </div>
  );
}

/** What the pixel stage should play for a verdict: your blow, the rage, the boss's move, a KO. */
export function beatsFor(o: Outcome, battle: Battle): Beat[] {
  const out: Beat[] = [];
  const struck = o.correct && (o.damage_dealt > 0 || (o.shield_absorbed ?? 0) > 0);
  if (struck) out.push({ kind: "hero-strike", heavy: o.move === "heavy", crit: !!o.weakness, shielded: o.damage_dealt === 0 });
  if (o.phase_changed) out.push({ kind: "rage" });
  const won = battle.status === "won";
  if (!won) {
    const kind = o.intent?.kind;
    if (o.damage_taken > 0 || o.blocked || o.aegis) out.push({ kind: "boss-strike", blocked: !!(o.blocked || o.aegis) && o.damage_taken === 0 });
    else if (kind === "shield") out.push({ kind: "boss-shield" });
    else if (kind === "heal" && (o.boss_healed ?? 0) > 0) out.push({ kind: "boss-heal" });
    else if (kind === "drain" && o.focus_drained) out.push({ kind: "boss-drain" });
  }
  if (won) out.push({ kind: "boss-ko" });
  else if (battle.status === "lost") out.push({ kind: "hero-ko" });
  return out;
}

/** The verdict's auto-advance as a draining bar (decorative: the Continue button is the real control). */
function AdvanceBar({ at, total }: { at: number | null; total: number }) {
  if (at === null) return <span className="arena-advance" data-held="true" aria-hidden="true" />;
  const left = Math.max(0, at - Date.now());
  return (
    <span className="arena-advance" aria-hidden="true">
      <span key={at} style={{ animationDuration: `${left}ms`, transform: `scaleX(${Math.min(1, left / total)})` }} />
    </span>
  );
}

/**
 * The fight. Left: the HUD (you, the clock, Focus and combo, the boss with its shield and its telegraphed intent) over
 * the scene. Right: what this turn needs - the move choice, the question, or the verdict - then items and retreat.
 */
export default function BattleScreen({ arena, context }: { arena: Arena; context?: React.ReactNode }) {
  const { battle, boss, question, stage, outcome, deadline, stock, itemBusy, advanceAt } = arena;
  const [confirmRetreat, setConfirmRetreat] = useState(false);
  const [retreating, setRetreating] = useState(false);
  const { answer, next } = arena;
  const nextRef = useRef<HTMLButtonElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const lastTaunt = useRef<string | undefined>(undefined);
  const fighter = useFighter();

  const clock = stage === "asking" || stage === "answering" ? deadline : null;
  const expired = useExpired(clock);
  const asking = stage === "asking" && question !== null && !expired;
  const showingVerdict = stage === "feedback" && outcome !== null;

  // Keyboard: 1-4 answer the question in the order the options are listed. One listener for the whole fight that
  // reads the current state from a ref, so there is never a moment between questions when a key press is lost.
  const keys = useRef({ asking, confirmRetreat, question, answer });
  keys.current = { asking, confirmRetreat, question, answer };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (k.confirmRetreat || !k.asking || shortcutBlocked(e)) return;
      const index = ["1", "2", "3", "4"].indexOf(e.key);
      const option = index >= 0 ? k.question?.options[index] : undefined;
      if (option !== undefined) { e.preventDefault(); void k.answer(option); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus follows the fight: the verdict's Continue button, then the next question.
  // On a phone the verdict can sit under the bottom navigation dock: bring Continue into view, clear of it
  // (its scroll-margin-bottom covers the dock); "nearest" leaves an already visible button where it is.
  useEffect(() => {
    if (!showingVerdict) return;
    nextRef.current?.focus({ preventScroll: true });
    nextRef.current?.scrollIntoView?.({ block: "nearest" });            // (absent in jsdom)
  }, [showingVerdict]);
  useEffect(() => { if (stage === "asking" && question) questionRef.current?.focus({ preventScroll: true }); }, [stage, question?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const floaters = useFloaters(outcome, showingVerdict);
  if (!battle || !boss) return null;
  if (outcome?.taunt) lastTaunt.current = outcome.taunt;
  const speech = outcome?.taunt ?? lastTaunt.current ?? boss.intro_taunt;
  const over = battle.status !== "active";
  const bossPct = Math.max(0, Math.min(100, (battle.boss.hp / Math.max(1, battle.boss.max_hp)) * 100));
  const shieldPct = Math.max(0, Math.min(100, ((battle.shield ?? 0) / Math.max(1, battle.boss.max_hp)) * 100));
  const focus = battle.focus ?? 0;
  const focusCap = battle.focus_cap ?? 5;
  const creature = bossById(boss.species ?? battle.boss.species);
  const casting = (itemBusy === "insight" || itemBusy === "timewarp") && question ? `c${question.id}-${itemBusy}` : "";
  // keyed on the answer, not the view: a timed-out question seen first as a notice, then as a verdict, plays once
  const beatKey = casting || ((showingVerdict || outcome?.timed_out) && outcome ? `o${outcome.question_id}` : "");
  const beats: Beat[] = casting ? [{ kind: "hero-cast" }] : beatKey && outcome ? beatsFor(outcome, battle) : [];
  const intentTint: IntentTint = !over && (stage === "choosing" || stage === "fetching" || stage === "asking") ? (battle.intent?.kind ?? null) : null;

  const optionState = (option: string) => {
    if (!showingVerdict || !outcome) return undefined;
    if (option === outcome.correct_answer) return "correct";
    if (option === outcome.answer) return "wrong";
    return undefined;
  };
  const spellOk = (cost: number) => asking && focus >= cost && itemBusy === null;

  return (
    <div className="arena arena--battle" data-stage={stage} data-rage={battle.rage || undefined}>
      <div className="arena-col arena-col--scene">
      {context}
      <header className="arena-hud ff-hud" aria-label="Battle status">
        <div className="arena-hud__you ff-hud__side">
          <span className="ff-hud__portrait" style={{ "--hero-accent": fighter.accent } as React.CSSProperties}>
            <PixelSprite hero={fighter} portrait className="ff-hud__face" />
          </span>
          <div className="arena-hud__youinfo">
            <span className="ff-hud__name pixel-font">{fighter.name}<span className="sr-only"> (you)</span></span>
            <Hearts hp={battle.player.hp} max={battle.player.max_hp} />
            <span className="inline-flex items-center gap-2"><span className="arena-stat__label">Focus</span><FocusPips focus={focus} cap={focusCap} /></span>
            <GearChips stats={battle.gear} className="gear-chips--tiny" />
          </div>
        </div>

        <div className="arena-hud__mid">
          <TimerRing deadline={clock} total={question?.time_limit ?? 30} />
          <span className="arena-combo" data-idle={battle.combo < 2 ? "true" : undefined} data-hot={battle.combo >= 3 ? "true" : undefined}>
            <Zap size={14} aria-hidden="true" />
            <span className="arena-stat__label">Combo</span>
            <span className="pixel-font">x{battle.combo}</span>
          </span>
        </div>

        <div className="arena-hud__boss ff-hud__side ff-hud__side--boss">
          <span className="ff-hud__portrait ff-hud__portrait--boss" style={{ "--hero-accent": creature.accent } as React.CSSProperties}>
            <PixelSprite boss={creature.id} portrait flip className="ff-hud__face" />
          </span>
          <div className="ff-hud__bossinfo">
            <div className="arena-hud__bossline">
              <div className="min-w-0">
                <h2 className="arena-hud__name pixel-font">{battle.boss.name}</h2>
                {(battle.boss.title || boss.title) && <p className="arena-hud__tagline">{battle.boss.title || boss.title}</p>}
              </div>
              <span className="inline-flex items-center gap-2 flex-wrap">
                {battle.mode === "nemesis" && <Badge tone="epic">Nemesis</Badge>}
                <Badge tone={battle.rage ? "danger" : "accent"}>{battle.rage ? "Enraged" : `Phase ${battle.phase}`}</Badge>
                <Badge>{DIFFICULTY_LABEL[battle.difficulty]}</Badge>
              </span>
            </div>
            <div
              className="arena-bar" role="progressbar" aria-label="Boss HP"
              aria-valuemin={0} aria-valuemax={battle.boss.max_hp} aria-valuenow={battle.boss.hp}
              aria-valuetext={`${battle.boss.hp} of ${battle.boss.max_hp}${battle.shield ? `, shield ${battle.shield}` : ""}`}
            >
              <span className="arena-bar__trail" style={{ width: `${bossPct}%` }} />
              <span className="arena-bar__fill" style={{ width: `${bossPct}%` }} />
              {shieldPct > 0 && <span className="arena-bar__shield" style={{ left: `${Math.max(0, bossPct - shieldPct)}%`, width: `${shieldPct}%` }} />}
            </div>
            <span className="arena-stat">
              <span className="arena-stat__label">Boss HP</span><span className="pixel-font">{battle.boss.hp}/{battle.boss.max_hp}</span>
              {(battle.shield ?? 0) > 0 && <span className="arena-stat__shield"><ShieldCheck size={13} aria-hidden="true" />{battle.shield}</span>}
            </span>
            {!over && stage !== "choosing" && <Intent intent={battle.intent} compact />}
          </div>
        </div>
      </header>

      <PixelArena
        hero={fighter} bossId={creature.id} rage={battle.rage} intent={intentTint} shield={battle.shield ?? 0}
        beats={beats} beatKey={beatKey} floaters={floaters} speech={speech}
        label={`${battle.boss.name}, the boss, a ${creature.name} of ${creature.origin} myth, faces ${fighter.name}`}
        introText={battle.mode === "nemesis" ? "NEMESIS" : battle.answered > 0 ? "RESUME" : "FIGHT!"}
      />
      </div>

      <div className="arena-col arena-col--play">
      {stage === "choosing" && !over && (
        <motion.div key="choose" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          {outcome?.timed_out && (
            <p className="arena-verdict__line" role="status">
              Time ran out on the last question{outcome.damage_taken > 0 ? `, and the boss struck for ${outcome.damage_taken}` : ""}.
            </p>
          )}
          <MovePicker battle={battle} onPick={arena.chooseMove} disabled={confirmRetreat} />
        </motion.div>
      )}

      {stage === "fetching" && (
        <motion.div key="fetch" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <ForgingWait first={battle.answered === 0} />
        </motion.div>
      )}

      {stage === "failed" && (
        <motion.div key="fail" className="arena-verdict" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h3 className="arena-verdict__head">The boss is gathering its thoughts</h3>
          <p className="arena-verdict__line">The next question could not be made just now. Nothing was lost: your battle is exactly where you left it.</p>
          <div className="arena-verdict__actions"><Button variant="primary" onClick={arena.retryQuestion}>Try again</Button></div>
        </motion.div>
      )}

      {question && (stage === "asking" || stage === "answering" || stage === "feedback") && (
        <motion.section key={`q${question.id}`} className="arena-question" aria-labelledby="arena-question-text"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          {stage === "asking" && outcome?.timed_out && (
            <p className="arena-verdict__line" role="status">
              Time ran out on the last question{outcome.damage_taken > 0 ? `, and the boss struck for ${outcome.damage_taken}` : ""}.
            </p>
          )}
          <div className="arena-question__meta">
            <Badge>Question {question.number}</Badge>
            {question.move && <Badge tone="accent">{MOVE_INFO[question.move].label}</Badge>}
            {question.weakness && <Badge tone="reward">Weakness x2</Badge>}
            {question.fifty_used && <Badge tone="accent">50/50</Badge>}
            {question.timewarped && <Badge tone="accent">+15s</Badge>}
          </div>
          <h3 id="arena-question-text" ref={questionRef} tabIndex={-1} className="arena-question__text">{question.question}</h3>
          <ol className="arena-options">
            {question.options.map((option, i) => (
              <li key={option}>
                <Button
                  className="arena-option" data-state={optionState(option)}
                  disabled={!asking} aria-keyshortcuts={String(i + 1)}
                  onClick={() => void arena.answer(option)}
                >
                  <span className="arena-option__key pixel-font" aria-hidden="true">{i + 1}</span>
                  <span>{option}</span>
                </Button>
              </li>
            ))}
          </ol>
          {asking && <p className="arena__sub">Press 1–{question.options.length} to answer</p>}
          {stage === "asking" && expired && <p className="arena-verdict__line" role="status">Time&apos;s up. Waiting for the boss&apos;s move…</p>}

          {(stage === "asking" || stage === "answering") && (
            <div className="arena-spells" role="group" aria-label="Spells">
              <Button size="sm" disabled={!spellOk(1) || !!question.fifty_used || question.options.length <= 2}
                      loading={itemBusy === "insight"} onClick={() => void arena.cast("insight")}>
                <Brain size={15} aria-hidden="true" />Insight <span className="arena-item-count pixel-font">1◆</span>
              </Button>
              <Button size="sm" disabled={!(spellOk(1) || (battle.free_timewarp && asking && itemBusy === null)) || !!question.timewarped}
                      loading={itemBusy === "timewarp"} onClick={() => void arena.cast("timewarp")}>
                <Hourglass size={15} aria-hidden="true" />Timewarp <span className="arena-item-count pixel-font">{battle.free_timewarp ? "free" : "1◆"}</span>
              </Button>
            </div>
          )}
        </motion.section>
      )}

      {showingVerdict && outcome && (
        <motion.section
          className="arena-verdict" data-correct={outcome.correct ? "true" : "false"} role="status" aria-label="Result of your answer"
          initial={{ opacity: 0, y: 16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 360, damping: 26 }}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") arena.holdVerdict(true); }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") arena.holdVerdict(false); }}
          onFocusCapture={(e) => { if (e.target !== nextRef.current) arena.holdVerdict(true); }}
          onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) arena.holdVerdict(false); }}
        >
          <h3 className="arena-verdict__head">{outcome.timed_out ? "Time's up!" : outcome.correct ? "Correct!" : "Not quite"}</h3>
          {outcome.damage_dealt > 0 && (
            <p className="arena-verdict__line">
              You hit {battle.boss.name} for {outcome.damage_dealt}
              {outcome.weakness ? ", right on its weakness" : ""}{outcome.combo > 1 ? ` (combo x${outcome.combo})` : ""}.
            </p>
          )}
          {(outcome.gear_bonus ?? 0) - (outcome.pet_strike ?? 0) > 0 && (
            <p className="arena-verdict__line arena-verdict__line--gear">Your weapon added {(outcome.gear_bonus ?? 0) - (outcome.pet_strike ?? 0)} damage.</p>
          )}
          {(outcome.pet_strike ?? 0) > 0 && <p className="arena-verdict__line arena-verdict__line--gear">Your pet struck for {outcome.pet_strike}.</p>}
          {(outcome.shield_absorbed ?? 0) > 0 && <p className="arena-verdict__line">The boss&apos;s shield absorbed {outcome.shield_absorbed}.</p>}
          {outcome.blocked && <p className="arena-verdict__line">You guarded: the boss&apos;s attack was blocked.</p>}
          {outcome.aegis && <p className="arena-verdict__line">Aegis absorbed the blow.</p>}
          {outcome.interrupted && <p className="arena-verdict__line">You interrupted the boss&apos;s heal.</p>}
          {(outcome.boss_healed ?? 0) > 0 && <p className="arena-verdict__line">The boss healed {outcome.boss_healed}.</p>}
          {outcome.damage_taken > 0 && (
            <p className="arena-verdict__line">{outcome.attack_name ? `${outcome.attack_name} hits you` : "The boss hits you"} for {outcome.damage_taken}.</p>
          )}
          {outcome.focus_drained ? <p className="arena-verdict__line">Your Focus was drained.</p> : null}
          {(outcome.focus_gained ?? 0) > 0 && <p className="arena-verdict__line">+{outcome.focus_gained} Focus.</p>}
          {outcome.revived && <p className="arena-verdict__line">Phoenix Ash! You rise again.</p>}
          {(outcome.lifesteal ?? 0) > 0 && <p className="arena-verdict__line">Vampiric Tome: +{outcome.lifesteal} heart.</p>}
          {outcome.phase_changed && <p className="arena-verdict__line">The boss is enraged!</p>}
          {!outcome.correct && <p className="arena-verdict__line">Correct answer: {outcome.correct_answer}</p>}
          {outcome.explanation && <p className="arena-verdict__line arena-verdict__explain">{outcome.explanation}</p>}
          {over && <p className="arena-verdict__line">{battle.status === "won" ? `${battle.boss.name} is defeated!` : "You have fallen."}</p>}
          {!over && outcome.next_intent && <div className="arena-verdict__next"><span className="arena-stat__label">Next, the boss:</span><Intent intent={outcome.next_intent} compact /></div>}
          <AdvanceBar at={advanceAt} total={outcome.correct ? 1800 : 6000} />
          <div className="arena-verdict__actions">
            <Button ref={nextRef} variant="primary" onClick={next}>{over ? "See result" : <>Continue <ChevronRight size={16} aria-hidden="true" /></>}</Button>
          </div>
        </motion.section>
      )}

      <div className="arena-items" role="group" aria-label="Items">
        <Button
          disabled={stage !== "asking" || stock.heal <= 0 || battle.player.hp >= battle.player.max_hp || itemBusy !== null}
          loading={itemBusy === "heal"} onClick={() => void arena.applyItem("heal")}
        >
          <FlaskConical size={16} aria-hidden="true" />Heal <span className="arena-item-count pixel-font">x{stock.heal}</span>
        </Button>
        <Button
          disabled={stage !== "asking" || stock.fifty_fifty <= 0 || !!question?.fifty_used || (question?.options.length ?? 0) <= 2 || itemBusy !== null}
          loading={itemBusy === "fifty_fifty"} onClick={() => void arena.applyItem("fifty_fifty")}
        >
          <Scissors size={16} aria-hidden="true" />50/50 <span className="arena-item-count pixel-font">x{stock.fifty_fifty}</span>
        </Button>
        <span className="arena-items__spacer" />
        {!over && <Button variant="ghost" onClick={() => setConfirmRetreat(true)}><Flag size={16} aria-hidden="true" />Retreat</Button>}
      </div>

      </div>

      <Modal
        open={confirmRetreat}
        onClose={() => setConfirmRetreat(false)}
        role="alertdialog"
        title="Retreat from the battle?"
        actions={
          <>
            <Button onClick={() => setConfirmRetreat(false)}>Keep fighting</Button>
            <Button
              variant="danger" loading={retreating}
              onClick={async () => { setRetreating(true); await arena.retreat(); setRetreating(false); setConfirmRetreat(false); }}
            >
              Retreat
            </Button>
          </>
        }
      >
        {battle.run_id ? "Retreating ends this battle as a loss - and ends your expedition." : "Retreating ends this battle as a loss. You can summon a new boss afterwards."}
      </Modal>
    </div>
  );
}
