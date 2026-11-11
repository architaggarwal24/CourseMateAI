// Kits (port of backend/core_brains/kits.py, grown for Your Hero): the abilities a fighter brings into a fight -
// a passive, an ultimate, weaknesses, and for your hero a fighting style, perks and skill-tree ranks - plus champion
// progression (XP, levels, mastery skins). The six champions have fixed kits; your hero's is built (build.ts).
// Every rule below is keyed by ABILITY, not by champion, so a champion's passive learned by your hero plays the same.
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

export interface Kit { champion: Champion; passive_name: string; passive_text: string; ultimate_name: string; ultimate_text: string; weakness_name: string; weakness_text: string }

// ── weaknesses (each champion's con, sized against its passive) ──────────────────────────────────────────────
export const GLASS_EDGE_HEARTS = 1;        // Kaien: a wrong Heavy also costs a heart
export const LONG_HAFT_EXTRA = 1;          // Asha: Heavy costs 1 more Focus
export const FRAIL_HEARTS = 2;             // Mira: 2 fewer hearts
export const LIGHT_BLADES_HEAVY = 1.5;     // Vex: Heavy hits x1.5 (not x1.8)
export const HEAVY_PLATE_CHARGE = 0.8;     // Thorne: the ultimate charges 20% slower

export const KITS: Record<Champion, Kit> = {
  kaien: { champion: "kaien", passive_name: "Riposte", passive_text: "A right Guard against a blow hits back for half a Strike.",
           ultimate_name: "Ninth Page Cut", ultimate_text: `Your next right answer hits x${CUT_MULT} and cuts through shields.`,
    weakness_name: "Glass Edge", weakness_text: `A wrong Heavy also costs you ${GLASS_EDGE_HEARTS} heart.` },
  asha: { champion: "asha", passive_name: "Reach", passive_text: `Your Jab hits x${ASHA_JAB_MULT} instead of x0.6.`,
          ultimate_name: "Dawn Wall", ultimate_text: `For ${WALL_TURNS} turns the boss's blows are halved and every right answer gives +1 Focus.`,
    weakness_name: "Long Haft", weakness_text: `Heavy costs ${2 + LONG_HAFT_EXTRA} Focus (not 2).` },
  brak: { champion: "brak", passive_name: "Iron Combo", passive_text: `Your combo bonus is doubled and grows up to ${BRAK_COMBO_CAP} (not 5).`,
          ultimate_name: "Iron Rush", ultimate_text: `Your next right answer hits x(1 + ${RUSH_PER_COMBO} x combo).`,
    weakness_name: "Reckless", weakness_text: "A right Guard halves a blow instead of blocking it." },
  mira: { champion: "mira", passive_name: "Quiet Study", passive_text: "A spell you cast gives its Focus back if you answer right.",
          ultimate_name: "Arcane Library", ultimate_text: `Insight and Timewarp, free, and your next right answer hits x${LIBRARY_MULT}.`,
    weakness_name: "Frail", weakness_text: `You fight with ${FRAIL_HEARTS} fewer hearts.` },
  vex: { champion: "vex", passive_name: "Shadowstep", passive_text: "Now and then you slip past a blow entirely (25% easy, 20% medium and hard, 15% nightmare).",
         ultimate_name: "Vanish", ultimate_text: `The boss's next ${VANISH_BLOWS} blows miss, and your next right answer hits x${VANISH_MULT}.`,
    weakness_name: "Light Blades", weakness_text: `Heavy hits x${LIGHT_BLADES_HEAVY} (not x1.8).` },
  thorne: { champion: "thorne", passive_name: "Bulwark", passive_text: "A right answer cuts a blow to a third instead of half.",
            ultimate_name: "Last Chapter", ultimate_text: `+${LAST_CHAPTER_HEARTS} hearts now, and the next turn's blow is fully blocked.`,
    weakness_name: "Heavy Plate", weakness_text: `Your ultimate charges ${Math.round((1 - HEAVY_PLATE_CHARGE) * 100)}% slower.` },
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

// ── the abilities (shared by champions and your hero) ────────────────────────────────────────────────────────
export type PassiveId = "riposte" | "reach" | "iron_combo" | "quiet_study" | "shadowstep" | "bulwark" | "second_wind" | "thick_skin" | "focus_flow";
export type UltimateId = "cut" | "wall" | "rush" | "library" | "vanish" | "last_chapter" | "rally" | "overdrive" | "aegis_dome" | "clarity";
export type WeaknessId = "glass_edge" | "long_haft" | "reckless" | "frail" | "light_blades" | "heavy_plate"
  | "untrained" | "loose_grip" | "paper_silk" | "wild_swing" | "brittle_guard" | "short_fuse" | "unfocused" | "slow_charge" | "glass_body";
export type StyleId = "apprentice" | "katana" | "spear" | "fists" | "staff" | "daggers" | "greatsword" | "chain_whip" | "war_fan" | "twin_kamas";
export type PerkId = "lucky_coin" | "scholar" | "combo_fuel" | "quick_hands" | "vampiric";
/** Skill-tree nodes: o = Offense, d = Defense, m = Mind; 1..6 top to bottom (build.ts has the tree itself). */
export type NodeId = `${"o" | "d" | "m"}${1 | 2 | 3 | 4 | 5 | 6}`;

export const OVERDRIVE_MULT = 1.6, OVERDRIVE_HITS = 2, DOME_BLOWS = 3, CLARITY_MULT = 1.5, RALLY_HEARTS = 2;
export const SECOND_WIND_HEARTS = 2, FOCUS_FLOW_EVERY = 3, OPENING_MULT = 1.25, FINISHER_MULT = 1.2, FINISHER_BELOW = 0.25;

const info = (name: string, text: string) => ({ name, text });
export const PASSIVES: Record<PassiveId, { name: string; text: string }> = {
  riposte: info("Riposte", "A right Guard against a blow hits back for half a Strike."),
  reach: info("Reach", `Your Jab hits x${ASHA_JAB_MULT} instead of x0.6.`),
  iron_combo: info("Iron Combo", `Your combo bonus is doubled and grows up to ${BRAK_COMBO_CAP} (not 5).`),
  quiet_study: info("Quiet Study", "A spell you cast gives its Focus back if you answer right."),
  shadowstep: info("Shadowstep", "Now and then you slip past a blow entirely (25% easy, 20% medium and hard, 15% nightmare)."),
  bulwark: info("Bulwark", "A right answer cuts a blow to a third instead of half."),
  second_wind: info("Second Wind", `Once a fight, when you drop to 1 heart, you heal ${SECOND_WIND_HEARTS}.`),
  thick_skin: info("Thick Skin", "The first wrong answer of a fight costs no heart."),
  focus_flow: info("Focus Flow", `+1 Focus every ${FOCUS_FLOW_EVERY} right answers.`),
};
export const ULTIMATES: Record<UltimateId, { name: string; text: string }> = {
  cut: info("Ninth Page Cut", `Your next right answer hits x${CUT_MULT} and cuts through shields.`),
  wall: info("Dawn Wall", `For ${WALL_TURNS} turns the boss's blows are halved and every right answer gives +1 Focus.`),
  rush: info("Iron Rush", `Your next right answer hits x(1 + ${RUSH_PER_COMBO} x combo).`),
  library: info("Arcane Library", `Insight and Timewarp, free, and your next right answer hits x${LIBRARY_MULT}.`),
  vanish: info("Vanish", `The boss's next ${VANISH_BLOWS} blows miss, and your next right answer hits x${VANISH_MULT}.`),
  last_chapter: info("Last Chapter", `+${LAST_CHAPTER_HEARTS} hearts now, and the next turn's blow is fully blocked.`),
  rally: info("Rally", `+${RALLY_HEARTS} hearts and +1 Focus.`),
  overdrive: info("Overdrive", `Your next ${OVERDRIVE_HITS} right answers hit x${OVERDRIVE_MULT}.`),
  aegis_dome: info("Aegis Dome", `The boss's next ${DOME_BLOWS} blows are halved.`),
  clarity: info("Clarity", `Insight, free, and your next right answer hits x${CLARITY_MULT}.`),
};
export const WEAKNESSES: Record<WeaknessId, { name: string; text: string; points: number }> = {
  glass_edge: { ...info("Glass Edge", `A wrong Heavy also costs you ${GLASS_EDGE_HEARTS} heart.`), points: 0 },
  long_haft: { ...info("Long Haft", `Heavy costs ${2 + LONG_HAFT_EXTRA} Focus (not 2).`), points: 0 },
  reckless: { ...info("Reckless", "A right Guard halves a blow instead of blocking it."), points: 0 },
  frail: { ...info("Frail", `You fight with ${FRAIL_HEARTS} fewer hearts.`), points: 0 },
  light_blades: { ...info("Light Blades", `Heavy hits x${LIGHT_BLADES_HEAVY} (not x1.8).`), points: 0 },
  heavy_plate: { ...info("Heavy Plate", `Your ultimate charges ${Math.round((1 - HEAVY_PLATE_CHARGE) * 100)}% slower.`), points: 0 },
  untrained: { ...info("Untrained", "Your ultimate charges 10% slower."), points: 0 },
  loose_grip: { ...info("Loose Grip", "Strike hits x0.9."), points: 0 },
  paper_silk: { ...info("Paper Silk", "Heavy costs 3 Focus (not 2)."), points: 0 },
  wild_swing: { ...info("Wild Swing", "A wrong answer costs 1 Focus."), points: 0 },
  // extra weaknesses your hero can take for loadout points
  brittle_guard: { ...info("Brittle Guard", "A right Guard halves a blow instead of blocking it."), points: 1 },
  short_fuse: { ...info("Short Fuse", "3 seconds less on every question."), points: 2 },
  unfocused: { ...info("Unfocused", "Your Focus caps at 4."), points: 2 },
  slow_charge: { ...info("Slow Charge", "Your ultimate charges 25% slower."), points: 2 },
  glass_body: { ...info("Glass Body", "You fight with 3 fewer hearts."), points: 3 },
};
export const EXTRA_WEAKNESSES: WeaknessId[] = ["brittle_guard", "short_fuse", "unfocused", "slow_charge", "glass_body"];

/** Fighting styles: a weapon class with its own moveset and animations (pixel `anim`), a move bonus and a weakness. */
export const STYLES: Record<StyleId, { name: string; bonus: string; weakness: WeaknessId; anim: string; champion?: Champion }> = {
  apprentice: { name: "Apprentice Blade", bonus: "A right Guard also gives +1 Focus.", weakness: "untrained", anim: "sword" },
  katana: { name: "Katana", bonus: "Strike hits x1.1.", weakness: "glass_edge", anim: "blade", champion: "kaien" },
  spear: { name: "Spear", bonus: `Jab hits x${ASHA_JAB_MULT}.`, weakness: "long_haft", anim: "lance", champion: "asha" },
  fists: { name: "Fists", bonus: "Your combo grows to 7 (not 5).", weakness: "reckless", anim: "fist", champion: "brak" },
  staff: { name: "Staff", bonus: "You start fights with 1 Focus.", weakness: "frail", anim: "mage", champion: "mira" },
  daggers: { name: "Twin Daggers", bonus: "10% chance to slip past a blow.", weakness: "light_blades", anim: "twin", champion: "vex" },
  greatsword: { name: "Greatsword", bonus: "Heavy hits x2.0.", weakness: "heavy_plate", anim: "heavy", champion: "thorne" },
  chain_whip: { name: "Chain Whip", bonus: "Jab hits x0.7 with 5 more seconds.", weakness: "loose_grip", anim: "whip" },
  war_fan: { name: "War Fan", bonus: "A right Jab gives +2 Focus (not 1).", weakness: "paper_silk", anim: "fan" },
  twin_kamas: { name: "Twin Kamas", bonus: "Your combo builds 1.5x faster.", weakness: "wild_swing", anim: "kamas" },
};
export const PERKS: Record<PerkId, { name: string; text: string; cost: number }> = {
  lucky_coin: { ...info("Lucky Coin", "+10% coins from fights."), cost: 1 },
  scholar: { ...info("Scholar", "+10% hero XP."), cost: 1 },
  combo_fuel: { ...info("Combo Fuel", "Your combo grows 1 higher."), cost: 2 },
  quick_hands: { ...info("Quick Hands", "3 more seconds on every question."), cost: 2 },
  vampiric: { ...info("Vampiric", "Every 5-combo heals 1 heart."), cost: 3 },
};

/** The six champions' fixed kits, by ability. */
export const CHAMPION_KIT: Record<Champion, { passive: PassiveId; ultimate: UltimateId; weakness: WeaknessId; style: StyleId }> = {
  kaien: { passive: "riposte", ultimate: "cut", weakness: "glass_edge", style: "katana" },
  asha: { passive: "reach", ultimate: "wall", weakness: "long_haft", style: "spear" },
  brak: { passive: "iron_combo", ultimate: "rush", weakness: "reckless", style: "fists" },
  mira: { passive: "quiet_study", ultimate: "library", weakness: "frail", style: "staff" },
  vex: { passive: "shadowstep", ultimate: "vanish", weakness: "light_blades", style: "daggers" },
  thorne: { passive: "bulwark", ultimate: "last_chapter", weakness: "heavy_plate", style: "greatsword" },
};

// ── the battle rules (port of kits.py prepare / settle / activate) ──────────────────────────────────────────
export const DIFFICULTY_INDEX: Record<string, number> = { easy: 0, medium: 1, hard: 2, nightmare: 3 };
export const METER_MAX = 100;
const METER_PER_RIGHT = 25, METER_STREAK_BONUS = 10, METER_STREAK_FROM = 3;
const RIPOSTE_RATIO = 0.5;
const BRAK_COMBO_STEP = 6, BASE_COMBO_CAP = 5, BASE_COMBO_STEP = 3;
const VEX_DODGE = [0.25, 0.2, 0.2, 0.15];
const DAGGER_DODGE = 0.1;
const THORNE_DIVISOR = 3;
const XP_PER_RIGHT = 10, XP_PER_WIN = 50;

export class NotReady extends Error {}
export class AlreadyActive extends Error {}

/** The fight events champion challenges count. */
export type FightStat = "riposte" | "right_jab" | "wall_blow" | "combo8" | "rush6" | "slip" | "right_block" | "ult_ko" | "spell" | "ultimate" | "heavy";

export interface KitState {
  /** A champion id, or "hero" for your hero (whose abilities come from its build). */
  champion: Champion | "hero";
  meter: number; armed: string | null; wall: number; vanish: number; fortress: number; spent: Record<string, number>; library_pending?: boolean;
  /** Fighting with the champion's own mastery weapon (SIGNATURES); `oath`: Thorne's first blow still to block. */
  signature?: boolean; oath?: number;
  /** What happened in this fight, for mastery challenges (mastery.ts): counted turn by turn, read at the end. */
  stats?: Partial<Record<FightStat, number>>;
  /** The abilities (missing on fights saved before Your Hero: then the champion's own, see kitOf). */
  passive?: PassiveId; ultimate?: UltimateId; weaknesses?: WeaknessId[]; style?: StyleId; perks?: PerkId[];
  tree?: Partial<Record<NodeId, number>>;
  /** Your hero's ultimates in play (Overdrive hits left, Aegis Dome blows left) and once-a-fight effects used. */
  overdrive?: number; dome?: number; used?: Partial<Record<"second_wind" | "thick_skin" | "last_stand" | "insight" | "opening", boolean>>; rights?: number;
  /** Your hero's name for the HUD. */
  name?: string;
}

/** A kit's abilities, filling in the champion's own for fights saved before abilities were stored. */
export function kitOf(s: KitState) {
  const own = s.champion !== "hero" ? CHAMPION_KIT[s.champion] ?? CHAMPION_KIT.kaien : null;
  const style = s.style ?? own?.style;
  const weaknesses = s.weaknesses ?? (own ? [own.weakness] : []);
  return { passive: s.passive ?? own?.passive ?? "second_wind", ultimate: s.ultimate ?? own?.ultimate ?? "rally", weaknesses, style, perks: s.perks ?? [], tree: s.tree ?? {} };
}
const has = (s: KitState, w: WeaknessId) => kitOf(s).weaknesses.includes(w);
const rank = (s: KitState, n: NodeId) => kitOf(s).tree[n] ?? 0;
const hero = (s: KitState) => s.champion === "hero";
const styleIs = (s: KitState, st: StyleId) => hero(s) && kitOf(s).style === st;
const perk = (s: KitState, p: PerkId) => kitOf(s).perks.includes(p);

export class KitTurn {
  mult = 1; ignoreShield = false; jabMult: number | null = null; comboExtra = 0; riposte = 0; divisor = 2;
  dodge = false; vanished = false; block = false; halveAfter = false; focusDelta = 0; refund = 0;
  /** Weaknesses: hearts a wrong move costs on top of the blow, a right Guard that only halves, a weaker Heavy. */
  selfDamage = 0; guardHalves = false; heavyMult: number | null = null; strikeMult: number | null = null;
  /** Your hero: the first wrong answer costs no heart (Thick Skin); a wrong Guard's blow cut 25% (Steady); a heal. */
  forgive = false; steady = false; heal = 0; comboBonus = 0;
  /** Set by the arena before prepare(): hearts now and the boss's share of HP left (Last Stand, Finisher). */
  hp = 99; bossRatio = 1;
  events: { type: string; text: string }[] = [];
  constructor(public champion: Champion | "hero", public difficulty: string, public state: KitState, public move: string, public correct: boolean,
              public combo: number, public damaging: boolean, public rng: () => number = Math.random, public seq: number | null = null) {
    if (kitOf(state).passive === "bulwark") this.divisor = THORNE_DIVISOR;
  }
  get d() { return DIFFICULTY_INDEX[this.difficulty] ?? 2; }
  event(type: string, text: string) { this.events.push({ type, text }); }
}

export const kitFor = (champion: unknown): Kit => KITS[(champion as Champion)] ?? KITS.kaien;
export function initKit(champion: unknown, signature = false): KitState {
  const c = kitFor(champion).champion, own = CHAMPION_KIT[c];
  const s: KitState = { champion: c, meter: 0, armed: null, wall: 0, vanish: 0, fortress: 0, spent: {},
    passive: own.passive, ultimate: own.ultimate, weaknesses: [own.weakness], style: own.style };
  if (signature) { s.signature = true; if (s.champion === "thorne") s.oath = 1; }
  return s;
}

/** Your hero's kit, from its build (build.ts validates it first). */
export function initHeroKit(b: { name: string; passive: PassiveId; ultimate: UltimateId; style: StyleId; perks: PerkId[]; weaknesses: WeaknessId[]; tree: Partial<Record<NodeId, number>> }): KitState {
  return { champion: "hero", name: b.name, meter: 0, armed: null, wall: 0, vanish: 0, fortress: 0, spent: {},
    passive: b.passive, ultimate: b.ultimate, style: b.style, perks: [...b.perks], tree: { ...b.tree },
    // the style's own weakness always comes with it; extra ones are the build's choice
    weaknesses: [STYLES[b.style].weakness, ...b.weaknesses.filter((w) => w !== STYLES[b.style].weakness)] };
}

export const meterGain = (correct: boolean, combo: number) => (correct ? METER_PER_RIGHT + (combo >= METER_STREAK_FROM ? METER_STREAK_BONUS : 0) : 0);
/** How fast this kit's ultimate charges (Heavy Plate, Untrained, Slow Charge slow it). */
export function chargeRate(s: KitState) {
  let r = 1;
  if (has(s, "heavy_plate")) r *= HEAVY_PLATE_CHARGE;
  if (has(s, "untrained")) r *= 0.9;
  if (has(s, "slow_charge")) r *= 0.75;
  return r;
}
export function charge(s: KitState, correct: boolean, combo: number): number {
  const extra = correct && s.signature && s.champion === "mira" ? SIGNATURE_METER : 0;
  const gain = Math.min(METER_MAX - (s.meter || 0), Math.round((meterGain(correct, combo) + extra) * chargeRate(s)));
  s.meter = (s.meter || 0) + gain;
  return gain;
}
export const ready = (s: KitState) => (s.meter || 0) >= METER_MAX;
export const active = (s: KitState) => !!(s.armed || s.wall || s.vanish || s.fortress || s.overdrive || s.dome);

export function activate(s: KitState) {
  if (!ready(s)) throw new NotReady();
  if (active(s)) throw new AlreadyActive();
  const ult = kitOf(s).ultimate, u = ULTIMATES[ult];
  s.meter = 0;
  const fx = { name: u.name, text: u.text, hearts: 0, insight: false, timewarp: false, focus: 0 };
  switch (ult) {
    case "cut": s.armed = "cut"; break;
    case "wall": s.wall = WALL_TURNS; break;
    case "rush": s.armed = "rush"; break;
    case "library": s.armed = "library"; fx.insight = true; fx.timewarp = true; break;
    case "vanish": s.vanish = VANISH_BLOWS; s.armed = "vanish"; break;
    case "last_chapter": s.fortress = 1; fx.hearts = LAST_CHAPTER_HEARTS; break;
    case "rally": fx.hearts = RALLY_HEARTS; fx.focus = 1; break;
    case "overdrive": s.overdrive = OVERDRIVE_HITS; break;
    case "aegis_dome": s.dome = DOME_BLOWS; break;
    case "clarity": s.armed = "clarity"; fx.insight = true; break;
  }
  return fx;
}

export function spent(s: KitState, seq: number, focus: number) {
  s.spent = s.spent ?? {};
  s.spent[String(seq)] = (s.spent[String(seq)] ?? 0) + focus;
}

/** The combo the damage bonus counts to (5 normally; Fists, Combo Fuel raise it; Iron Combo doubles it). */
export function comboCap(s: KitState) {
  return BASE_COMBO_CAP + (styleIs(s, "fists") ? 2 : 0) + (perk(s, "combo_fuel") ? 1 : 0);
}

export function prepare(t: KitTurn) {
  const s = t.state, cid = t.champion, k = kitOf(s);
  const sig = !!s.signature;
  // passives
  if (k.passive === "riposte" && t.correct && t.move === "guard" && t.damaging) t.riposte = sig && cid === "kaien" ? SIGNATURE_RIPOSTE : RIPOSTE_RATIO;
  if (k.passive === "reach" && t.move === "jab") t.jabMult = sig && cid === "asha" ? SIGNATURE_JAB : ASHA_JAB_MULT;
  if (t.correct) {
    // the combo bonus counts higher (Fists, Combo Fuel), builds faster (Twin Kamas) or doubles (Iron Combo)
    const cap = comboCap(s), eff = styleIs(s, "twin_kamas") ? Math.floor(t.combo * 1.5) : t.combo;
    let extra = (Math.min(eff, cap) - Math.min(t.combo, BASE_COMBO_CAP)) * BASE_COMBO_STEP;
    if (k.passive === "iron_combo") extra = Math.min(t.combo, BRAK_COMBO_CAP) * BRAK_COMBO_STEP - Math.min(t.combo, BASE_COMBO_CAP) * BASE_COMBO_STEP;
    t.comboExtra = Math.max(0, extra);
  }
  if (t.damaging) {
    const slip = (k.passive === "shadowstep" ? VEX_DODGE[t.d] + (sig && cid === "vex" ? SIGNATURE_DODGE : 0) : 0) + (styleIs(s, "daggers") ? DAGGER_DODGE : 0);
    if (slip > 0 && t.rng() < slip) t.dodge = true;
  }
  // ultimates in play
  const armed = s.armed;
  if (t.correct && armed === "cut") { t.mult = CUT_MULT; t.ignoreShield = true; }
  else if (t.correct && armed === "rush") t.mult = 1 + RUSH_PER_COMBO * t.combo;
  else if (t.correct && armed === "library") t.mult = LIBRARY_MULT;
  else if (t.correct && armed === "vanish") t.mult = VANISH_MULT;
  else if (t.correct && armed === "clarity") t.mult = CLARITY_MULT;
  if (t.correct && (s.overdrive || 0) > 0) t.mult *= OVERDRIVE_MULT;
  if (((s.wall || 0) > 0 || (s.dome || 0) > 0) && t.damaging) t.halveAfter = true;
  if ((s.vanish || 0) > 0 && t.damaging) { t.dodge = true; t.vanished = true; }
  if ((s.fortress || 0) > 0) t.block = true;
  if (sig && cid === "brak" && t.correct && t.move === "heavy") t.mult *= SIGNATURE_HEAVY;
  if ((s.oath || 0) > 0 && t.damaging) t.block = true;
  // weaknesses
  if (has(s, "glass_edge") && !t.correct && t.move === "heavy") t.selfDamage = GLASS_EDGE_HEARTS;
  if ((has(s, "reckless") || has(s, "brittle_guard")) && t.move === "guard") t.guardHalves = true;
  if (has(s, "light_blades") && t.move === "heavy") t.heavyMult = LIGHT_BLADES_HEAVY;
  if (has(s, "loose_grip") && t.move === "strike") t.strikeMult = 0.9;
  // your hero: style, tree and perks
  if (hero(s)) {
    if (styleIs(s, "katana") && t.move === "strike") t.strikeMult = (t.strikeMult ?? 1) * 1.1;
    if (styleIs(s, "spear") && t.move === "jab") t.jabMult = Math.max(t.jabMult ?? 0, ASHA_JAB_MULT);
    if (styleIs(s, "chain_whip") && t.move === "jab") t.jabMult = Math.max(t.jabMult ?? 0, 0.7);
    if (styleIs(s, "greatsword") && t.move === "heavy") t.heavyMult = 2.0;
    if (t.move === "strike" && rank(s, "o1")) t.strikeMult = (t.strikeMult ?? 1) * (1 + 0.05 * rank(s, "o1"));
    if (t.move === "heavy" && rank(s, "o4")) t.heavyMult = (t.heavyMult ?? 1.8) + 0.1 * rank(s, "o4");
    if (t.correct && rank(s, "o2") && !s.used?.opening) t.mult *= OPENING_MULT;
    if (t.correct && rank(s, "o5") && t.bossRatio < FINISHER_BELOW) t.mult *= FINISHER_MULT;
    if (!t.correct && k.passive === "thick_skin" && !s.used?.thick_skin) t.forgive = true;
    if (!t.correct && t.move === "guard" && rank(s, "d4")) t.steady = true;
    if (t.correct && t.move === "guard" && rank(s, "d2")) t.comboBonus = 1;          // Parry
    if (!t.correct && t.move === "guard" && t.hp <= 1 && rank(s, "d5") && !s.used?.last_stand && t.damaging) t.block = true;
  }
}

export function settle(t: KitTurn) {
  const s = t.state, cid = t.champion, k = kitOf(s);
  if (k.passive === "quiet_study" && t.seq !== null) {
    const paid = s.spent?.[String(t.seq)] ?? 0;
    if (s.spent) delete s.spent[String(t.seq)];
    if (t.correct && paid) { t.refund = paid; t.event("refund", `Quiet Study: ${paid} Focus comes back.`); }
  }
  const ultName = ULTIMATES[k.ultimate].name;
  if (t.correct && ["cut", "rush", "library", "vanish", "clarity"].includes(s.armed ?? "")) { t.event("ultimate_hit", `${ultName} lands!`); s.armed = null; }
  if (t.correct && (s.overdrive || 0) > 0) { t.event("ultimate_hit", `${ultName} lands!`); s.overdrive = (s.overdrive || 0) - 1; }
  if ((s.wall || 0) > 0) { if (t.correct) t.focusDelta += 1; s.wall -= 1; }
  if ((s.dome || 0) > 0 && t.damaging) s.dome = (s.dome || 0) - 1;
  if (t.vanished) { s.vanish = Math.max(0, (s.vanish || 0) - 1); t.event("vanish", "The blow passes through a shadow."); }
  else if (t.dodge) t.event("shadowstep", k.passive === "shadowstep" ? "Shadowstep: you slip past the blow." : "You slip past the blow.");
  if (t.selfDamage) t.event("weakness", `${WEAKNESSES.glass_edge.name}: the miss costs you a heart.`);
  if ((s.fortress || 0) > 0) { s.fortress = 0; t.event("fortress", "The Last Chapter holds: nothing gets through."); }
  else if ((s.oath || 0) > 0 && t.damaging) { s.oath = 0; t.event("fortress", "Oathshield: the first blow breaks on Thorne's shield."); }
  // your hero's Focus from its style, tree and weaknesses
  if (hero(s)) {
    s.used = s.used ?? {};
    if (t.correct) {
      if (styleIs(s, "apprentice") && t.move === "guard") t.focusDelta += 1;
      if (styleIs(s, "war_fan") && t.move === "jab") t.focusDelta += 1;
      s.rights = (s.rights ?? 0) + 1;
      if (k.passive === "focus_flow" && s.rights % FOCUS_FLOW_EVERY === 0) { t.focusDelta += 1; t.event("focus_flow", "Focus Flow: +1 Focus."); }
      if (rank(s, "o2")) s.used.opening = true;
    } else if (has(s, "wild_swing")) t.focusDelta -= 1;
    if (t.forgive) { s.used.thick_skin = true; t.event("thick_skin", "Thick Skin: the miss costs no heart."); }
    if (t.block && !t.correct && t.move === "guard" && rank(s, "d5") && t.hp <= 1 && !s.used.last_stand) { s.used.last_stand = true; t.event("last_stand", "Last Stand: you hold the line."); }
  }
  void cid;
}

/** After the blow: Second Wind heals once when the hero drops to 1 heart (returns the hearts healed). */
export function afterBlow(s: KitState, hearts: number, max: number, t?: KitTurn): number {
  if (kitOf(s).passive !== "second_wind" || s.used?.second_wind || hearts !== 1) return 0;
  s.used = { ...(s.used ?? {}), second_wind: true };
  const healed = Math.max(0, Math.min(SECOND_WIND_HEARTS, max - hearts));
  if (healed && t) t.event("second_wind", `Second Wind: +${healed} hearts.`);
  return healed;
}

/** Focus a Heavy costs this kit (Long Haft and Paper Silk add one), on top of what relics already decided. */
export const heavyCostFor = (champion: unknown, base: number, s?: KitState) =>
  base + ((s ? has(s, "long_haft") || has(s, "paper_silk") : kitFor(champion).champion === "asha") ? LONG_HAFT_EXTRA : 0);
/** Hearts this kit fights with (Frail, Glass Body take some; the Tough node adds). */
export function heartsFor(champion: unknown, base: number, s?: KitState) {
  if (!s) return Math.max(1, base - (kitFor(champion).champion === "mira" ? FRAIL_HEARTS : 0));
  return Math.max(1, base - (has(s, "frail") ? FRAIL_HEARTS : 0) - (has(s, "glass_body") ? 3 : 0) + rank(s, "d1"));
}
/** Focus cap and starting Focus (Deep Focus, Unfocused; the Staff starts with 1). */
export const focusCapFor = (s: KitState, base: number) => Math.max(1, (has(s, "unfocused") ? 4 : base) + (rank(s, "m4") ? 1 : 0));
export const startFocusFor = (s: KitState) => (styleIs(s, "staff") ? 1 : 0);
/** Seconds added to (or taken from) a question's timer by this kit. */
export const timeBonusFor = (s: KitState, move: string) =>
  (rank(s, "m5") ? 2 : 0) + (perk(s, "quick_hands") ? 3 : 0) - (has(s, "short_fuse") ? 3 : 0) + (styleIs(s, "chain_whip") && move === "jab" ? 5 : 0);
/** The first Insight of a fight is free (Insightful); true once, then it is used. */
export function freeInsight(s: KitState): boolean {
  if (!hero(s) || !rank(s, "m2") || s.used?.insight) return false;
  s.used = { ...(s.used ?? {}), insight: true };
  return true;
}
/** Vampiric perk: every 5-combo heals 1 heart. */
export const vampiric = (s: KitState, combo: number) => perk(s, "vampiric") && combo > 0 && combo % 5 === 0;

export function kitHud(s: KitState) {
  const k = kitOf(s);
  const named = s.champion === "hero" ? { name: s.name ?? "Your hero" } : null;
  return {
    champion: s.champion, meter: s.meter || 0, max: METER_MAX, ready: ready(s), active: active(s),
    passive: PASSIVES[k.passive], ultimate: ULTIMATES[k.ultimate],
    weakness: k.weaknesses.length ? { name: k.weaknesses.map((w) => WEAKNESSES[w].name).join(" · "), text: k.weaknesses.map((w) => WEAKNESSES[w].text).join(" ") } : undefined,
    effects: Object.fromEntries((["armed", "wall", "vanish", "fortress", "overdrive", "dome"] as const).filter((x) => s[x]).map((x) => [x, s[x]])),
    signature: s.signature && s.champion !== "hero" ? { name: SIGNATURES[s.champion].perk_name, text: SIGNATURES[s.champion].perk_text, finisher: SIGNATURES[s.champion].finisher } : null,
    style: k.style ? { id: k.style, name: STYLES[k.style].name } : null,
    hero: named,
  };
}

export const bumpStat = (s: KitState, k: FightStat, n = 1) => { s.stats = s.stats ?? {}; s.stats[k] = (s.stats[k] ?? 0) + n; };

export const battleXp = (correct: number, won: boolean) => XP_PER_RIGHT * correct + (won ? XP_PER_WIN : 0);
export const unlockedBetween = (champion: string, oldLevel: number, newLevel: number) =>
  masteryUnlocks(champion).filter((u) => oldLevel < u.level && u.level <= newLevel);
