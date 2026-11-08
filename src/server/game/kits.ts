// Champion kits (port of backend/core_brains/kits.py): each champion's passive and ultimate, and champion
// progression (XP, levels, mastery skins). The battle rules that use the kits are in arena code (Stage 4.5b).
import type { Champion } from "./content";

export const CUT_MULT = 2.5;
export const ASHA_JAB_MULT = 0.8;
export const WALL_TURNS = 2;
export const BRAK_COMBO_CAP = 8;
export const RUSH_PER_COMBO = 0.25;
export const LIBRARY_MULT = 2.0;
export const VANISH_BLOWS = 2;
export const VANISH_MULT = 1.5;
export const LAST_CHAPTER_HEARTS = 3;

export interface Kit { champion: Champion; passive_name: string; passive_text: string; ultimate_name: string; ultimate_text: string }

export const KITS: Record<Champion, Kit> = {
  kaien: { champion: "kaien", passive_name: "Riposte", passive_text: "A right Guard against a blow hits back for half a Strike.",
           ultimate_name: "Ninth Page Cut", ultimate_text: `Your next right answer hits x${CUT_MULT} and cuts through shields.` },
  asha: { champion: "asha", passive_name: "Reach", passive_text: `Your Jab hits x${ASHA_JAB_MULT} instead of x0.6.`,
          ultimate_name: "Dawn Wall", ultimate_text: `For ${WALL_TURNS} turns the boss's blows are halved and every right answer gives +1 Focus.` },
  brak: { champion: "brak", passive_name: "Iron Combo", passive_text: `Your combo bonus is doubled and grows up to ${BRAK_COMBO_CAP} (not 5).`,
          ultimate_name: "Iron Rush", ultimate_text: `Your next right answer hits x(1 + ${RUSH_PER_COMBO} x combo).` },
  mira: { champion: "mira", passive_name: "Quiet Study", passive_text: "A spell you cast gives its Focus back if you answer right.",
          ultimate_name: "Arcane Library", ultimate_text: `Insight and Timewarp, free, and your next right answer hits x${LIBRARY_MULT}.` },
  vex: { champion: "vex", passive_name: "Shadowstep", passive_text: "Now and then you slip past a blow entirely (25% easy, 20% medium and hard, 15% nightmare).",
         ultimate_name: "Vanish", ultimate_text: `The boss's next ${VANISH_BLOWS} blows miss, and your next right answer hits x${VANISH_MULT}.` },
  thorne: { champion: "thorne", passive_name: "Bulwark", passive_text: "A right answer cuts a blow to a third instead of half.",
            ultimate_name: "Last Chapter", ultimate_text: `+${LAST_CHAPTER_HEARTS} hearts now, and the next turn's blow is fully blocked.` },
};

/**
 * A champion fighting with their own mastery weapon (the level 10 skin): one small perk, exclusive attack and
 * ultimate animations, and a finisher on the KO (Stage C1). The perks are deliberately small.
 */
export const SIGNATURE_RIPOSTE = 0.75;
export const SIGNATURE_JAB = 0.9;
export const SIGNATURE_HEAVY = 1.1;
export const SIGNATURE_METER = 5;
export const SIGNATURE_DODGE = 0.05;
export interface Signature { weapon: string; perk_name: string; perk_text: string; finisher: string }
export const SIGNATURES: Record<Champion, Signature> = {
  kaien: { weapon: "mastery_kaien_weapon", perk_name: "Edge of the Ninth Page", perk_text: `Riposte hits back for ${SIGNATURE_RIPOSTE * 100}% of a Strike (not half).`, finisher: "Final Cut" },
  asha: { weapon: "mastery_asha_weapon", perk_name: "Dawnpiercer", perk_text: `Your Jab hits x${SIGNATURE_JAB} (not x${ASHA_JAB_MULT}).`, finisher: "Sunfall" },
  brak: { weapon: "mastery_brak_weapon", perk_name: "Iron Knuckles", perk_text: `A right Heavy hits ${Math.round((SIGNATURE_HEAVY - 1) * 100)}% harder.`, finisher: "Thousand Fists" },
  mira: { weapon: "mastery_mira_weapon", perk_name: "Ink Reserve", perk_text: `Each right answer charges your ultimate ${SIGNATURE_METER} more.`, finisher: "Last Word" },
  vex: { weapon: "mastery_vex_weapon", perk_name: "Ghost Edge", perk_text: `${SIGNATURE_DODGE * 100}% more chance to slip past a blow.`, finisher: "Eclipse" },
  thorne: { weapon: "mastery_thorne_weapon", perk_name: "Oathshield", perk_text: "The first blow of every fight is fully blocked.", finisher: "Closing Chapter" },
};
export const hasSignature = (champion: string, equipped: Record<string, string | undefined>) =>
  !!SIGNATURES[champion as Champion] && equipped.weapon === SIGNATURES[champion as Champion].weapon;

export const LEVEL_XP = [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700];
export const MAX_LEVEL = LEVEL_XP.length;
const MASTERY: [string, string, number][] = [["outfit", "armor", 3], ["head", "headgear", 6], ["weapon", "weapon", 10]];

export const levelFor = (xp: number) => LEVEL_XP.reduce((lvl, need, i) => (xp >= need ? i + 1 : lvl), 1);
export const nextLevelXp = (level: number): number | null => (level < MAX_LEVEL ? LEVEL_XP[level] : null);
export const masteryUnlocks = (champion: string) => MASTERY.map(([part, slot, level]) => ({ id: `mastery_${champion}_${part}`, slot, level }));

// ── the battle rules (port of kits.py prepare / settle / activate) ──────────────────────────────────────────
export const DIFFICULTY_INDEX: Record<string, number> = { easy: 0, medium: 1, hard: 2, nightmare: 3 };
export const METER_MAX = 100;
const METER_PER_RIGHT = 25, METER_STREAK_BONUS = 10, METER_STREAK_FROM = 3;
const RIPOSTE_RATIO = 0.5;
const BRAK_COMBO_STEP = 6, BASE_COMBO_CAP = 5, BASE_COMBO_STEP = 3;
const VEX_DODGE = [0.25, 0.2, 0.2, 0.15];
const THORNE_DIVISOR = 3;
const XP_PER_RIGHT = 10, XP_PER_WIN = 50;

export class NotReady extends Error {}
export class AlreadyActive extends Error {}

export interface KitState {
  champion: Champion; meter: number; armed: string | null; wall: number; vanish: number; fortress: number; spent: Record<string, number>; library_pending?: boolean;
  /** Fighting with the champion's own mastery weapon (SIGNATURES); `oath`: Thorne's first blow still to block. */
  signature?: boolean; oath?: number;
}

export class KitTurn {
  mult = 1; ignoreShield = false; jabMult: number | null = null; comboExtra = 0; riposte = 0; divisor = 2;
  dodge = false; vanished = false; block = false; halveAfter = false; focusDelta = 0; refund = 0;
  events: { type: string; text: string }[] = [];
  constructor(public champion: Champion, public difficulty: string, public state: KitState, public move: string, public correct: boolean,
              public combo: number, public damaging: boolean, public rng: () => number = Math.random, public seq: number | null = null) {
    if (champion === "thorne") this.divisor = THORNE_DIVISOR;
  }
  get d() { return DIFFICULTY_INDEX[this.difficulty] ?? 2; }
  event(type: string, text: string) { this.events.push({ type, text }); }
}

export const kitFor = (champion: unknown): Kit => KITS[(champion as Champion)] ?? KITS.kaien;
export function initKit(champion: unknown, signature = false): KitState {
  const s: KitState = { champion: kitFor(champion).champion, meter: 0, armed: null, wall: 0, vanish: 0, fortress: 0, spent: {} };
  if (signature) { s.signature = true; if (s.champion === "thorne") s.oath = 1; }
  return s;
}
export const meterGain = (correct: boolean, combo: number) => (correct ? METER_PER_RIGHT + (combo >= METER_STREAK_FROM ? METER_STREAK_BONUS : 0) : 0);
export function charge(s: KitState, correct: boolean, combo: number): number {
  const extra = correct && s.signature && s.champion === "mira" ? SIGNATURE_METER : 0;
  const gain = Math.min(METER_MAX - (s.meter || 0), meterGain(correct, combo) + extra);
  s.meter = (s.meter || 0) + gain;
  return gain;
}
export const ready = (s: KitState) => (s.meter || 0) >= METER_MAX;
export const active = (s: KitState) => !!(s.armed || s.wall || s.vanish || s.fortress);

export function activate(s: KitState) {
  if (!ready(s)) throw new NotReady();
  if (active(s)) throw new AlreadyActive();
  const kit = kitFor(s.champion);
  s.meter = 0;
  const fx = { name: kit.ultimate_name, text: kit.ultimate_text, hearts: 0, insight: false, timewarp: false };
  switch (kit.champion) {
    case "kaien": s.armed = "cut"; break;
    case "asha": s.wall = WALL_TURNS; break;
    case "brak": s.armed = "rush"; break;
    case "mira": s.armed = "library"; fx.insight = true; fx.timewarp = true; break;
    case "vex": s.vanish = VANISH_BLOWS; s.armed = "vanish"; break;
    case "thorne": s.fortress = 1; fx.hearts = LAST_CHAPTER_HEARTS; break;
  }
  return fx;
}

export function spent(s: KitState, seq: number, focus: number) {
  s.spent = s.spent ?? {};
  s.spent[String(seq)] = (s.spent[String(seq)] ?? 0) + focus;
}

export function prepare(t: KitTurn) {
  const s = t.state, cid = t.champion;
  const sig = !!s.signature;
  if (cid === "kaien" && t.correct && t.move === "guard" && t.damaging) t.riposte = sig ? SIGNATURE_RIPOSTE : RIPOSTE_RATIO;
  if (cid === "asha" && t.move === "jab") t.jabMult = sig ? SIGNATURE_JAB : ASHA_JAB_MULT;
  if (cid === "brak" && t.correct) t.comboExtra = Math.min(t.combo, BRAK_COMBO_CAP) * BRAK_COMBO_STEP - Math.min(t.combo, BASE_COMBO_CAP) * BASE_COMBO_STEP;
  if (cid === "vex" && t.damaging && t.rng() < VEX_DODGE[t.d] + (sig ? SIGNATURE_DODGE : 0)) t.dodge = true;
  const armed = s.armed;
  if (t.correct && armed === "cut") { t.mult = CUT_MULT; t.ignoreShield = true; }
  else if (t.correct && armed === "rush") t.mult = 1 + RUSH_PER_COMBO * t.combo;
  else if (t.correct && armed === "library") t.mult = LIBRARY_MULT;
  else if (t.correct && armed === "vanish") t.mult = VANISH_MULT;
  if ((s.wall || 0) > 0 && t.damaging) t.halveAfter = true;
  if ((s.vanish || 0) > 0 && t.damaging) { t.dodge = true; t.vanished = true; }
  if ((s.fortress || 0) > 0) t.block = true;
  if (sig && cid === "brak" && t.correct && t.move === "heavy") t.mult *= SIGNATURE_HEAVY;
  if ((s.oath || 0) > 0 && t.damaging) t.block = true;
}

export function settle(t: KitTurn) {
  const s = t.state, cid = t.champion;
  if (cid === "mira" && t.seq !== null) {
    const paid = s.spent?.[String(t.seq)] ?? 0;
    if (s.spent) delete s.spent[String(t.seq)];
    if (t.correct && paid) { t.refund = paid; t.event("refund", `Quiet Study: ${paid} Focus comes back.`); }
  }
  if (t.correct && ["cut", "rush", "library", "vanish"].includes(s.armed ?? "")) { t.event("ultimate_hit", `${kitFor(cid).ultimate_name} lands!`); s.armed = null; }
  if ((s.wall || 0) > 0) { if (t.correct) t.focusDelta += 1; s.wall -= 1; }
  if (t.vanished) { s.vanish = Math.max(0, (s.vanish || 0) - 1); t.event("vanish", "The blow passes through a shadow."); }
  else if (t.dodge) t.event("shadowstep", "Shadowstep: you slip past the blow.");
  if ((s.fortress || 0) > 0) { s.fortress = 0; t.event("fortress", "The Last Chapter holds: nothing gets through."); }
  else if ((s.oath || 0) > 0 && t.damaging) { s.oath = 0; t.event("fortress", "Oathshield: the first blow breaks on Thorne's shield."); }
}

export function kitHud(s: KitState) {
  const kit = kitFor(s.champion);
  return {
    champion: kit.champion, meter: s.meter || 0, max: METER_MAX, ready: ready(s), active: active(s),
    passive: { name: kit.passive_name, text: kit.passive_text }, ultimate: { name: kit.ultimate_name, text: kit.ultimate_text },
    effects: Object.fromEntries((["armed", "wall", "vanish", "fortress"] as const).filter((k) => s[k]).map((k) => [k, s[k]])),
    signature: s.signature ? { name: SIGNATURES[kit.champion].perk_name, text: SIGNATURES[kit.champion].perk_text, finisher: SIGNATURES[kit.champion].finisher } : null,
  };
}

export const battleXp = (correct: number, won: boolean) => XP_PER_RIGHT * correct + (won ? XP_PER_WIN : 0);
export const unlockedBetween = (champion: string, oldLevel: number, newLevel: number) =>
  masteryUnlocks(champion).filter((u) => oldLevel < u.level && u.level <= newLevel);
