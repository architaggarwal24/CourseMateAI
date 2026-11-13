"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Brain, ChevronRight, Flag, Flame, FlaskConical, Hourglass, Pause, Scissors, ShieldCheck, Swords, Zap } from "@/components/ui/icons";
import { tauntLine } from "@/lib/arena/emotes";
import { music } from "@/lib/sound/chip";
import SoundToggle from "@/components/fx/SoundToggle";
import GearChips from "@/components/champion/GearChips";
import { Badge, Button, Modal } from "@/components/ui";
import { type useArenaBattle } from "@/hooks/useArenaBattle";
import { shortcutBlocked } from "@/lib/keys";
import { DIFFICULTY_LABEL, MOVE_INFO, type Battle, type Outcome } from "@/lib/arena/types";
import { bossById } from "@/lib/pixel/bosses";
import { MECHANIC_FX, type Beat, type IntentTint, type MechanicEffect } from "@/lib/pixel/fight";
import FocusPips from "./FocusPips";
import Hearts from "./Hearts";
import Intent from "./Intent";
import MechanicHud from "./MechanicHud";
import BaneHud from "./BaneHud";
import MovePicker from "./MovePicker";
import PixelArena, { type Floater } from "./pixel/PixelArena";
import PixelSprite from "./pixel/PixelSprite";
import { useFighter, useFighterMount, useFighterPet } from "./pixel/useFighter";
import TimerRing from "./TimerRing";
import UltimateMeter from "./UltimateMeter";
import { mechanicLines } from "./verdict";
import ForgingWait from "./ForgingWait";
import EffectChips, { EffectIcon, useQuestionFx } from "./EffectChips";
import ContinueScreen from "./ContinueScreen";
import { usePause } from "@/hooks/usePause";

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
      next.push({ id: `d${id}`, side: "boss", text: `-${outcome.damage_dealt}`, kind: outcome.weakness || outcome.bane?.landed ? "crit" : "hit",
        sub: outcome.bane?.landed ? "Bane!" : outcome.weakness ? "Weakness!" : outcome.move === "heavy" ? "Heavy!" : undefined });
      if ((outcome.pet_strike ?? 0) > 0) next.push({ id: `p${id}`, side: "boss", text: `+${outcome.pet_strike}`, kind: "pet", sub: "Pet strike" });
    }
    if ((outcome.shield_absorbed ?? 0) > 0) next.push({ id: `s${id}`, side: "boss", text: `${outcome.shield_absorbed}`, kind: "shield", sub: "Shielded" });
    if ((outcome.boss_healed ?? 0) > 0) next.push({ id: `bh${id}`, side: "boss", text: `+${outcome.boss_healed}`, kind: "heal", sub: "Boss healed" });
    if (outcome.blocked || outcome.aegis) next.push({ id: `b${id}`, side: "hero", text: "Blocked", kind: "block" });
    if (outcome.damage_taken > 0) next.push({ id: `t${id}`, side: "hero", text: `-${outcome.damage_taken}`, kind: "hurt" });
    if ((outcome.focus_gained ?? 0) > 0) next.push({ id: `f${id}`, side: "hero", text: `+${outcome.focus_gained}`, kind: "focus", sub: "Focus" });
    if ((outcome.points ?? 0) > 0) next.push({ id: `pt${id}`, side: "boss", text: `+${outcome.points}`, kind: "focus", sub: outcome.combo_special ? "Combo special!" : "Points" });
    const fx = outcome.effects;
    if (fx && fx.damage > 0) next.push({ id: `x${id}`, side: "hero", text: `-${fx.damage}`, kind: "hurt", sub: fx.ticked.map((t) => t.name).join(", ") });
    if (fx?.landed) next.push({ id: `l${id}`, side: "hero", text: fx.landed.name, kind: "block", sub: "Effect" });
    setFloaters(next);
    const timer = setTimeout(() => setFloaters([]), 1600);
    return () => clearTimeout(timer);
  }, [id, show]); // eslint-disable-line react-hooks/exhaustive-deps
  return floaters;
}

/**
 * The FINAL MOVE (Stage 4): the boss is on its knees; one quick question finishes it with your champion's own
 * finisher. Enter or F (or the button) asks it.
 */
function FinalMovePrompt({ name, onGo, disabled }: { name: string; onGo: () => void; disabled?: boolean }) {
  const live = useRef({ onGo, disabled });
  live.current = { onGo, disabled };
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (live.current.disabled || shortcutBlocked(e)) return;
      if ((e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) || e.key.toLowerCase() === "f" || e.key === " ") { e.preventDefault(); live.current.onGo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <section className="arena-finale" aria-labelledby="arena-finale-title">
      <h3 id="arena-finale-title" ref={heading} tabIndex={-1} className="arena-finale__title pixel-font">Final move!</h3>
      <p className="m-0 text-sm text-fg-2">{name} can barely stand. Answer one quick question to finish it with your finisher. Miss, and it staggers back up.</p>
      <Button variant="reward" size="lg" onClick={onGo} disabled={disabled} aria-keyshortcuts="F"><Swords size={18} aria-hidden="true" />Final move</Button>
    </section>
  );
}

/** What the announcer shouts after a right answer (nothing for an ordinary hit). */
export function comboCallout(combo: number, bane?: boolean, weakness?: boolean): string | undefined {
  if (bane) return "BANE!";
  if (combo >= 10) return `UNSTOPPABLE x${combo}!`;
  if (combo >= 8) return `RAMPAGE x${combo}!`;
  if (combo >= 5) return `COMBO x${combo}!`;
  if (combo === 3) return "COMBO x3!";
  if (weakness) return "WEAK SPOT!";
  return undefined;
}

/** Kit / mechanic events that land before your blow (they make it bigger). */
const BEFORE_STRIKE: readonly string[] = ["feather", "ultimate_hit"];
/** Events that answer the boss's blow (a charge staggered on your guard, the Last Chapter holding). */
const AFTER_BLOW: readonly string[] = ["stunned", "fortress"];
/** The boss's side of a mechanic: what it does to you or for itself after the exchange. */
const BOSS_SIDE: readonly string[] = ["regrowth", "devour", "riddle_failed", "illusion", "grabbed", "drum", "venom", "poisoned", "wisdom", "squeeze", "shapeshift"];
/** Events that are a dodge (played as the dodge itself, not as an effect). */
export const DODGE_EVENTS: readonly string[] = ["dodged", "shadowstep", "vanish"];

/**
 * What the pixel stage should play for a verdict, in the order it happened: effects that boost your blow, your blow,
 * what it set off (chains, a broken drum, a stolen treasure...), the rage, the boss's move (a swing, a charge, a
 * thrown boulder, or a dodge), a riposte, the creature's own move (a regrown head, a grab, coils...), then a KO.
 */
export function beatsFor(o: Outcome, battle: Battle, rageLine?: string): Beat[] {
  const out: Beat[] = [];
  const events = [...(o.mechanic?.events ?? []), ...(o.kit?.events ?? [])].map((e) => e.type);
  const effect = (t: string): Beat => ({ kind: "mechanic", effect: t as MechanicEffect });
  const known = (t: string) => t in MECHANIC_FX;
  const pick = (group: readonly string[]) => events.filter((t) => group.includes(t) && known(t)).map(effect);

  out.push(...pick(BEFORE_STRIKE));
  // fighting with the champion's own mastery weapon: their own strike animation, and a finisher for the KO
  const sig = battle.kit?.signature ?? null;
  const struck = o.correct && (o.damage_dealt > 0 || (o.shield_absorbed ?? 0) > 0);
  if (struck && !o.finisher) out.push({ kind: "hero-strike", heavy: o.move === "heavy", crit: !!o.weakness || !!o.bane?.landed, shielded: o.damage_dealt === 0, ...(sig ? { signature: true } : {}), ...(o.combo_special ? { special: true } : {}) });
  // the bane staggers it: the same reel as a stunned creature
  if (o.bane?.landed && "stunned" in MECHANIC_FX) out.push(effect("stunned"));
  const heroSide = events.filter((t) => known(t) && ![...BEFORE_STRIKE, ...AFTER_BLOW, ...BOSS_SIDE].includes(t));
  out.push(...heroSide.map(effect));
  if (o.phase_changed) out.push({ kind: "rage", text: rageLine });
  const won = battle.status === "won";
  if (!won) {
    const kind = o.intent?.kind;
    const style: Partial<Beat> = kind === "charge" ? { charge: true } : kind === "throw" ? { projectile: true } : {};
    const dodged = !!o.dodged || events.some((t) => DODGE_EVENTS.includes(t));
    if (dodged && o.damage_taken === 0) out.push({ kind: "dodge", ...style });
    else if (o.damage_taken > 0 || o.blocked || o.aegis) {
      out.push({ kind: "boss-strike", blocked: !!(o.blocked || o.aegis) && o.damage_taken === 0, ...style, ...(kind === "fury" ? { hits: o.intent?.hits ?? 2, fury: true } : {}) });
    }
    if (o.effects?.landed) out.push({ kind: "hex", effectKind: o.effects.landed.kind, text: o.effects.landed.name.toUpperCase() });
    else if (kind === "shield") out.push({ kind: "boss-shield" });
    else if (kind === "heal" && (o.boss_healed ?? 0) > 0) out.push({ kind: "boss-heal" });
    else if (kind === "drain" && o.focus_drained) out.push({ kind: "boss-drain" });
    out.push(...pick(AFTER_BLOW));
    if ((o.riposte ?? 0) > 0) out.push({ kind: "riposte" });
    out.push(...pick(BOSS_SIDE));
  }
  // the FINAL MOVE: the champion's own finisher (a fight won another way ends on the usual fall)
  if (won) out.push(o.finisher ? { kind: "finisher", text: o.finisher.name.toUpperCase() } : sig ? { kind: "finisher", text: sig.finisher.toUpperCase() } : { kind: "boss-ko" });
  else if (battle.status === "lost") out.push({ kind: "hero-ko" });
  else if (o.knocked_down) out.push({ kind: "hero-down" });
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
  const pet = useFighterPet();
  const { petStage, mount } = useFighterMount();

  // two worlds, Stage 3: the pause menu stops an open question's clock (and hides it); closing it resumes
  const pauseOpen = usePause((s) => s.open);
  const { pauseFight, resumeFight } = arena;
  useEffect(() => { if (pauseOpen) pauseFight(); else void resumeFight(); }, [pauseOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // two worlds, Stage 5: Insight (from studying) brought a free 50/50 to this fight
  const fifties = stock.fifty_fifty + (battle?.insight?.fifty ? 1 : 0);
  const clock = stage === "asking" || stage === "answering" ? deadline : null;
  const expired = useExpired(clock);
  const asking = stage === "asking" && question !== null && !expired;
  const showingVerdict = stage === "feedback" && outcome !== null;

  // Keyboard: 1-4 answer the question in the order the options are listed. One listener for the whole fight that
  // reads the current state from a ref, so there is never a moment between questions when a key press is lost.
  const ultReady = !!battle?.kit?.ready && !battle?.kit?.active && (stage === "choosing" || asking);
  const tauntReady = !!battle && battle.status === "active" && !battle.taunted && (stage === "choosing" || asking) && arena.itemBusy === null;
  const qfx = useQuestionFx(question, asking);
  const keys = useRef({ asking, confirmRetreat, order: qfx.order, answer, ultReady, ultimate: arena.ultimate, tauntReady, taunt: arena.taunt, showingVerdict, next });
  keys.current = { asking, confirmRetreat, order: qfx.order, answer, ultReady, ultimate: arena.ultimate, tauntReady, taunt: arena.taunt, showingVerdict, next };
  // A layout effect: bound as the screen appears, so a key pressed the moment it shows is never missed.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current;
      if (k.confirmRetreat || shortcutBlocked(e)) return;
      if (e.key.toLowerCase() === "u" && k.ultReady) { e.preventDefault(); void k.ultimate(); return; }
      if (e.key.toLowerCase() === "t" && k.tauntReady) { e.preventDefault(); void k.taunt(); return; }
      // Enter or Space: on with the fight from the verdict (a focused button answers its own key press)
      if ((e.key === "Enter" || e.key === " ") && k.showingVerdict && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); k.next(); return; }
      if (!k.asking) return;
      const index = ["1", "2", "3", "4"].indexOf(e.key);
      const option = index >= 0 ? k.order[index] : undefined;
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
  // arena music while the fight is on (faster drums once the boss rages)
  const fighting = !!battle && battle.status === "active";
  useEffect(() => { if (!fighting) return; music.play("arena"); return () => music.stop(); }, [fighting]);
  useEffect(() => { music.intensity(!!battle?.rage); }, [battle?.rage]);
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
  const ultKey = arena.ultimateCast ? `u${arena.ultimateCast.key}` : "";
  const tauntKey = arena.tauntCast ? `t${arena.tauntCast.key}` : "";
  // keyed on the answer, not the view: a timed-out question seen first as a notice, then as a verdict, plays once
  const beatKey = casting || tauntKey || ultKey || ((showingVerdict || outcome?.timed_out) && outcome ? `o${outcome.question_id}` : "");
  const beats: Beat[] = casting ? [{ kind: "hero-cast" }]
    : tauntKey ? [{ kind: "taunt", enraged: arena.tauntCast!.enraged }]
    : ultKey ? [{ kind: "ultimate", text: arena.ultimateCast!.name.toUpperCase(), ...(battle.kit?.signature ? { signature: true } : {}) }]
    : beatKey && outcome ? beatsFor(outcome, battle, boss.phase2_taunts?.[0]) : [];
  const intentTint: IntentTint = !over && (stage === "choosing" || stage === "fetching" || stage === "asking") ? (battle.intent?.kind ?? null) : null;

  const optionState = (option: string) => {
    if (!showingVerdict || !outcome) return undefined;
    if (option === outcome.correct_answer) return "correct";
    if (option === outcome.answer) return "wrong";
    return undefined;
  };
  const spellOk = (cost: number) => asking && focus >= cost && itemBusy === null && !battle.silenced;

  return (
    <div className="arena arena--battle fight" data-stage={stage} data-rage={battle.rage || undefined}>
      <div className="fight__frame">
      {context}
      <header className="arena-hud ff-hud fight-hud" aria-label="Battle status">
        <div className="arena-hud__you ff-hud__side">
          <span className="ff-hud__portrait" style={{ "--hero-accent": fighter.accent } as React.CSSProperties}>
            <PixelSprite hero={fighter} portrait className="ff-hud__face" />
            {pet && <span className="ff-hud__pet" data-pet={pet}><PixelSprite pet={pet} className="ff-hud__pet-sprite" /></span>}
          </span>
          <div className="arena-hud__youinfo">
            <span className="ff-hud__name pixel-font">{fighter.name}<span className="sr-only"> (you)</span></span>
            <Hearts hp={battle.player.hp} max={battle.player.max_hp} />
            <EffectChips effects={battle.effects} />
            <span className="inline-flex items-center gap-2"><span className="arena-stat__label">Focus</span><FocusPips focus={focus} cap={focusCap} /></span>
            <UltimateMeter kit={battle.kit} compact />
            {battle.kit?.signature && (
              <span className="arena-ult__sig fight-hud__sig" title={battle.kit.signature.text}>
                Signature weapon · {battle.kit.signature.name}<span className="sr-only">: {battle.kit.signature.text}</span>
              </span>
            )}
            <GearChips stats={battle.gear} className="gear-chips--tiny" />
          </div>
        </div>

        <div className="arena-hud__mid">
          <TimerRing deadline={clock} total={question?.time_limit ?? 30} />
          <span className="arena-combo" data-idle={battle.combo < 2 ? "true" : undefined} data-hot={battle.combo >= 3 ? "true" : undefined} data-level={battle.combo_level ?? 1}>
            <span className="sr-only">{`Combo ${battle.combo} in a row${(battle.combo_level ?? 1) > 1 ? `, x${battle.combo_level} damage and points` : ""}`}</span>
            <Zap size={14} aria-hidden="true" />
            <span className="arena-stat__label" aria-hidden="true">Combo</span>
            <span className="pixel-font" aria-hidden="true">x{battle.combo_level ?? 1}</span>
            <span className="arena-combo__count" aria-hidden="true">{battle.combo}</span>
          </span>
          <span className="arena-score">
            <span className="sr-only">{`Score ${battle.score ?? 0}`}</span>
            <span className="arena-stat__label" aria-hidden="true">Score</span>
            <span className="pixel-font" aria-hidden="true">{String(battle.score ?? 0).padStart(6, "0")}</span>
          </span>
          {battle.insight && (
            <span className="arena-insight" title="Insight from your studying: +1 Focus and a free 50/50 this fight">
              <Brain size={13} aria-hidden="true" /><span className="sr-only">Insight: +1 Focus and a free 50/50 this fight{battle.insight.fifty ? "" : " (50/50 used)"}</span>
              <span className="arena-stat__label" aria-hidden="true">Insight</span>
            </span>
          )}
          <SoundToggle kind="music" className="arena-hud__music" />
          {/* the pause menu by touch (Esc on a keyboard): a phone call, a bus stop - the clock stops */}
          <Button size="sm" variant="ghost" icon className="arena-hud__pause" onClick={() => usePause.getState().show()} aria-label="Pause" title="Pause (Esc)">
            <Pause size={14} aria-hidden="true" />
          </Button>
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
          </div>
        </div>
      </header>

      <div className="fight__stage">
      <div className="arena-items fight-tray" role="group" aria-label="Items">
        <Button
          disabled={stage !== "asking" || stock.heal <= 0 || battle.player.hp >= battle.player.max_hp || itemBusy !== null || !!battle.cursed}
          title={battle.cursed ? "Cursed: no potions for now" : undefined}
          loading={itemBusy === "heal"} onClick={() => void arena.applyItem("heal")}
        >
          <FlaskConical size={16} aria-hidden="true" /><span className="fight-tray__label">Heal</span> <span className="arena-item-count pixel-font">x{stock.heal}</span>
        </Button>
        <Button
          disabled={stage !== "asking" || fifties <= 0 || !!question?.fifty_used || (question?.options.length ?? 0) <= 2 || itemBusy !== null || !!battle.cursed}
          title={battle.cursed ? "Cursed: no potions for now" : undefined}
          loading={itemBusy === "fifty_fifty"} onClick={() => void arena.applyItem("fifty_fifty")}
        >
          <Scissors size={16} aria-hidden="true" /><span className="fight-tray__label">50/50</span> <span className="arena-item-count pixel-font">x{fifties}</span>
        </Button>
        {!over && <UltimateMeter kit={battle.kit} onCast={() => void arena.ultimate()} busy={itemBusy === "ultimate"} signature={false}
                                 disabled={!(stage === "choosing" || asking) || (itemBusy !== null && itemBusy !== "ultimate")} />}
        {!over && (
          <Button variant="danger" className="arena-taunt" disabled={!tauntReady} loading={itemBusy === "taunt"} aria-keyshortcuts="T"
            onClick={() => void arena.taunt()} title="Once a fight: the boss rages and hits harder; your ultimate gets +50% and the win pays +25%.">
            <Flame size={16} aria-hidden="true" /><span className="fight-tray__label">{battle.taunted ? "Taunted" : "Taunt"}</span>
            <span className="arena-item-count pixel-font">{battle.taunted ? "+25%" : "T"}</span>
          </Button>
        )}
        <span className="arena-spells" role="group" aria-label="Spells">
          <Button size="sm" disabled={!question || !spellOk(1) || !!question.fifty_used || question.options.length <= 2 || !!question.riddle}
                  title={battle.silenced ? "Silenced: no spells for now" : question?.riddle ? "A riddle can't be narrowed down" : "Spend 1 Focus: two wrong options vanish"}
                  loading={itemBusy === "insight"} onClick={() => void arena.cast("insight")}>
            <Brain size={15} aria-hidden="true" /><span className="fight-tray__label">Insight</span> <span className="arena-item-count pixel-font">1◆</span>
          </Button>
          <Button size="sm" disabled={!question || !(spellOk(1) || (battle.free_timewarp && asking && itemBusy === null && !battle.silenced)) || !!question.timewarped}
                  title={battle.silenced ? "Silenced: no spells for now" : "Spend 1 Focus: +15 seconds on this question"}
                  loading={itemBusy === "timewarp"} onClick={() => void arena.cast("timewarp")}>
            <Hourglass size={15} aria-hidden="true" /><span className="fight-tray__label">Timewarp</span> <span className="arena-item-count pixel-font">{battle.free_timewarp ? "free" : "1◆"}</span>
          </Button>
        </span>
        <span className="arena-items__spacer" />
        {!over && <Button variant="ghost" onClick={() => setConfirmRetreat(true)} aria-label="Retreat"><Flag size={16} aria-hidden="true" /><span className="fight-tray__label">Retreat</span></Button>}
      </div>
      <div className="fight__screen">
      <PixelArena
        hero={fighter} pet={pet} petStage={petStage} mount={mount} bossId={creature.id} stageId={battle.stage ?? undefined} rage={battle.rage} down={!!battle.down} intent={intentTint} shield={battle.shield ?? 0}
        beats={beats} beatKey={beatKey} floaters={floaters} speech={speech}
        heroSpeech={arena.tauntCast ? { text: tauntLine(fighter.id, arena.tauntCast.key), key: arena.tauntCast.key } : undefined}
        callout={showingVerdict && outcome && outcome.correct ? comboCallout(outcome.combo, outcome.bane?.landed, outcome.weakness) : undefined}
        calloutKey={outcome?.question_id}
        label={`${battle.boss.name}, the boss, a ${creature.name} of ${creature.origin} myth, faces ${fighter.name}`}
        introText={battle.answered > 0 ? "RESUME" : undefined}
      />
      </div>
      </div>

      <div className="fight__panel arena-col--play" data-verdict={showingVerdict || undefined}>
      {stage === "choosing" && !over && (
        <motion.div key="choose" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          {outcome?.timed_out && (
            <p className="arena-verdict__line" role="status">
              Time ran out on the last question{outcome.damage_taken > 0 ? `, and the boss struck for ${outcome.damage_taken}` : ""}.
            </p>
          )}
          <BaneHud bane={battle.bane} />
          {battle.finale
            ? <FinalMovePrompt name={battle.boss.name} onGo={() => arena.chooseMove("strike")} disabled={confirmRetreat} />
            : <MovePicker battle={battle} onPick={arena.chooseMove} disabled={confirmRetreat} repeat={arena.lastMove} />}
        </motion.div>
      )}

      {stage === "down" && !over && battle.down && (
        <ContinueScreen battle={battle} potions={stock.heal} onContinue={arena.continueWith} onGiveUp={() => void arena.retreat()} onTimeout={() => void arena.settleDown()} />
      )}

      {stage === "paused" && (
        <motion.div key="paused" className="arena-verdict arena-paused" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h3 className="arena-verdict__head pixel-font">Paused</h3>
          <p className="arena-verdict__line">The question is hidden and its clock has stopped. {battle.pauses_left !== undefined && `${battle.pauses_left} ${battle.pauses_left === 1 ? "pause" : "pauses"} left this fight.`}</p>
          {!pauseOpen && <div className="arena-verdict__actions"><Button variant="primary" onClick={() => void resumeFight()}>Resume</Button></div>}
        </motion.div>
      )}

      {stage === "fetching" && (
        <motion.div key="fetch" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <ForgingWait preparing={!battle.prepared} />
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
            {question.finale ? <span className="arena-finale-badge"><Badge tone="reward">FINAL MOVE</Badge></span> : <Badge>Question {question.number}</Badge>}
            {question.move && <Badge tone="accent">{MOVE_INFO[question.move].label}</Badge>}
            {question.weakness && <Badge tone="reward">Weakness x2</Badge>}
            {question.fifty_used && <Badge tone="accent">50/50</Badge>}
            {question.timewarped && <Badge tone="accent">+15s</Badge>}
            {question.riddle && <Badge tone="reward">Riddle: no Insight</Badge>}
            {question.special === "illusion" && <Badge tone="epic">Illusion: one option is fake</Badge>}
            {question.special === "hoard" && <Badge tone="reward">Treasure</Badge>}
            {/* what the boss does if this goes wrong (and its creature's counters), beside the question */}
            {!over && <span className="arena-question__threat"><Intent intent={battle.intent} compact /><MechanicHud mechanic={battle.mechanic} compact /></span>}
          </div>
          <h3 id="arena-question-text" ref={questionRef} tabIndex={-1} className="arena-question__text" data-fogged={qfx.fogged || undefined}>{question.question}</h3>
          {(qfx.blinded || qfx.fogged) && (
            <p className="arena-question__hex" role="status">
              <EffectIcon kind={qfx.blinded ? "blind" : "fog"} />{qfx.blinded ? "Blinded: the options appear in a moment…" : "Fogged: the question clears in a moment…"}
            </p>
          )}
          <ol className="arena-options" data-blinded={qfx.blinded || undefined} data-shuffled={qfx.shuffled || undefined}>
            {(showingVerdict ? question.options : qfx.order).map((option, i) => (
              <li key={option}>
                <Button
                  className="arena-option" data-state={optionState(option)}
                  disabled={!asking} aria-keyshortcuts={String(i + 1)} aria-label={qfx.blinded ? `Option ${i + 1}, hidden` : undefined}
                  onClick={() => void arena.answer(option)}
                >
                  <span className="arena-option__key pixel-font" aria-hidden="true">{i + 1}</span>
                  <span aria-hidden={qfx.blinded || undefined}>{qfx.blinded ? "? ? ?" : option}</span>
                </Button>
              </li>
            ))}
          </ol>
          {asking && <p className="arena__sub">Press 1–{question.options.length} to answer</p>}
          {stage === "asking" && expired && <p className="arena-verdict__line" role="status">Time&apos;s up. Waiting for the boss&apos;s move…</p>}

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
          {outcome.bane?.landed && (
            <p className="arena-verdict__line arena-verdict__line--bane">
              {outcome.bane.found ? `You found the ${battle.boss.name}'s bane! It staggers and loses its turn.` : `Bane! The ${battle.boss.name} staggers and loses its turn.`}
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
          {mechanicLines(outcome).map((line, i) => <p key={`m${i}`} className="arena-verdict__line arena-verdict__line--mech">{line}</p>)}
          {outcome.combo_special && <p className="arena-verdict__line arena-verdict__line--special">Combo special! x5 and a flourish: that one hit half again as hard.</p>}
          {outcome.finisher && <p className="arena-verdict__line arena-verdict__line--special">{outcome.finisher.name}! Your final move ends it.</p>}
          {outcome.finale_armed && <p className="arena-verdict__line arena-verdict__line--special">{battle.boss.name} is on its knees: your FINAL MOVE is next.</p>}
          {outcome.finale_missed && <p className="arena-verdict__line">The final move missed: {battle.boss.name} staggers back up (+{outcome.boss_healed}).</p>}
          {outcome.knocked_down && <p className="arena-verdict__line arena-verdict__line--rage">You&apos;re down! Continue?</p>}
          {outcome.phase_changed && <p className="arena-verdict__line arena-verdict__line--rage">{boss.phase2_taunts?.[0] ?? "The boss is enraged!"} It is enraged: stronger, faster, and its own blows now.</p>}
          {outcome.effects?.landed && (
            <p className="arena-verdict__line arena-verdict__line--hex"><EffectIcon kind={outcome.effects.landed.kind} />{outcome.effects.landed.name}! {outcome.effects.landed.text}.</p>
          )}
          {(outcome.effects?.ticked ?? []).filter((t) => t.damage > 0).map((t) => (
            <p key={`tk${t.id}`} className="arena-verdict__line arena-verdict__line--hex">{t.name}: -{t.damage} {t.damage === 1 ? "heart" : "hearts"}.</p>
          ))}
          {(outcome.effects?.sapped ?? 0) > 0 && <p className="arena-verdict__line arena-verdict__line--hex">Your ultimate meter lost {outcome.effects!.sapped}.</p>}
          {(outcome.effects?.expired ?? []).length > 0 && <p className="arena-verdict__line">{outcome.effects!.expired.join(", ")} wore off.</p>}
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
