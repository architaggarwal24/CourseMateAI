// What a boss's blows do to your champion besides hearts (Stage 3): burns and poisons, a frozen clock, a locked move,
// blinded options... Every boss carries a few from the SHARED pool in its normal form (drawn when the fight starts)
// and, once enraged, its OWN two or three. A blow's effect is telegraphed with its intent, and it lands only on a
// wrong answer (or a timeout): a right answer shrugs it off. Effects last a number of questions and tick after each.
import { pick, type Boss, type Intent, type Rng } from "./boss";

/** How an effect works. Its `power` and `turns` say how strongly and for how many questions. */
export type EffectKind =
  | "dot"      // -power hearts after each question
  | "clock"    // the answer clock runs at power (0.5 = half the time)
  | "lock"     // the moves in `moves` (or one at random) can't be picked
  | "silence"  // no spells (Insight, Timewarp)
  | "curse"    // no potions (Heal, 50/50)
  | "weaken"   // your hits deal power less (0.25 = -25%)
  | "blind"    // the options stay hidden for the first `power` seconds
  | "fog"      // the question is blurred for the first `power` seconds
  | "shuffle"  // the options reshuffle `power` times while you answer
  | "sap"      // at once: the ultimate meter loses power (0.25 = a quarter)
  | "drain";   // at once: -power Focus

export interface EffectDef { id: string; name: string; kind: EffectKind; power: number; turns: number; moves?: string[]; text: string }
/** An effect on the champion now: what it is, and how many more questions it lasts. */
export interface ActiveEffect { id: string; name: string; kind: EffectKind; power: number; turns: number; moves?: string[]; text: string; boss?: boolean }

const def = (id: string, name: string, kind: EffectKind, power: number, turns: number, text: string, moves?: string[]): EffectDef =>
  ({ id, name, kind, power, turns, text, ...(moves ? { moves } : {}) });

/** The shared pool: any boss in its normal form carries two or three of these. */
export const POOL: readonly EffectDef[] = [
  def("burn", "Burn", "dot", 1, 2, "-1 heart after each of the next 2 questions"),
  def("poison", "Poison", "dot", 1, 3, "-1 heart after each of the next 3 questions"),
  def("freeze", "Freeze", "clock", 0.5, 1, "half the time on the next question"),
  def("slow", "Slow", "clock", 0.75, 2, "a quarter less time on the next 2 questions"),
  def("stun", "Stun", "lock", 1, 1, "one of your moves is locked for a turn", ["random"]),
  def("silence", "Silence", "silence", 1, 2, "no spells for 2 turns"),
  def("curse", "Curse", "curse", 1, 2, "no potions for 2 turns"),
  def("weaken", "Weaken", "weaken", 0.25, 2, "your hits deal 25% less for 2 turns"),
  def("blind", "Blind", "blind", 3, 1, "the options stay hidden for 3 seconds"),
  def("fog", "Fog", "fog", 3, 1, "the question is blurred for 3 seconds"),
  def("confuse", "Confuse", "shuffle", 1, 1, "the options shuffle while you answer"),
  def("sap", "Sap", "sap", 0.25, 0, "your ultimate meter loses a quarter"),
];

/** Each creature's own effects, its enraged form's: stronger, and only its own. */
export const UNIQUE: Readonly<Record<string, readonly EffectDef[]>> = {
  hydra: [
    def("hydra_venom", "Hundred-Fang Venom", "dot", 1, 4, "-1 heart after each of the next 4 questions"),
    def("hydra_heads", "Heads Everywhere", "shuffle", 2, 1, "the options shuffle twice while you answer"),
    def("hydra_bile", "Hydra Bile", "weaken", 0.35, 2, "your hits deal 35% less for 2 turns"),
  ],
  kraken: [
    def("kraken_ink", "Ink Cloud", "blind", 4, 2, "the options stay hidden for 4 seconds, 2 questions"),
    def("kraken_grip", "Crushing Grip", "lock", 1, 1, "Strike and Heavy are locked for a turn", ["strike", "heavy"]),
    def("kraken_undertow", "Undertow", "clock", 0.6, 2, "less time on the next 2 questions"),
  ],
  sphinx: [
    def("sphinx_hush", "Riddle Hush", "silence", 1, 3, "no spells for 3 turns"),
    def("sphinx_sand", "Sand Blindness", "fog", 4, 2, "the question is blurred for 4 seconds, 2 questions"),
    def("sphinx_gaze", "Timeless Gaze", "clock", 0.5, 2, "half the time on the next 2 questions"),
  ],
  kitsune: [
    def("kitsune_fire", "Foxfire", "dot", 1, 3, "-1 heart after each of the next 3 questions"),
    def("kitsune_tails", "Nine-Tail Trick", "shuffle", 2, 2, "the options shuffle twice, 2 questions"),
    def("kitsune_mirage", "Mirage", "blind", 3, 2, "the options stay hidden for 3 seconds, 2 questions"),
  ],
  fenrir: [
    def("fenrir_rend", "Rending Bite", "dot", 2, 2, "-2 hearts after each of the next 2 questions"),
    def("fenrir_howl", "Dread Howl", "lock", 1, 2, "one of your moves is locked for 2 turns", ["random"]),
    def("fenrir_fury", "Ragnarok Fury", "weaken", 0.3, 2, "your hits deal 30% less for 2 turns"),
  ],
  ammit: [
    def("ammit_rot", "Heart Rot", "dot", 1, 3, "-1 heart after each of the next 3 questions"),
    def("ammit_scales", "Scales of Judgement", "curse", 1, 3, "no potions for 3 turns"),
    def("ammit_devour", "Devour Will", "sap", 0.5, 0, "your ultimate meter loses half"),
  ],
  minotaur: [
    def("minotaur_gore", "Gore", "dot", 2, 1, "-2 hearts after the next question"),
    def("minotaur_daze", "Labyrinth Daze", "lock", 1, 2, "one of your moves is locked for 2 turns", ["random"]),
    def("minotaur_stampede", "Stampede", "clock", 0.6, 1, "much less time on the next question"),
  ],
  cyclops: [
    def("cyclops_quake", "Earthshake", "lock", 1, 2, "Heavy is locked for 2 turns", ["heavy"]),
    def("cyclops_eye", "Evil Eye", "fog", 3, 2, "the question is blurred for 3 seconds, 2 questions"),
    def("cyclops_shrapnel", "Stone Shrapnel", "dot", 1, 2, "-1 heart after each of the next 2 questions"),
  ],
  oni: [
    def("oni_fire", "Oni Fire", "dot", 1, 3, "-1 heart after each of the next 3 questions"),
    def("oni_roar", "Demon Roar", "silence", 1, 2, "no spells for 2 turns"),
    def("oni_club", "Iron Club", "weaken", 0.3, 2, "your hits deal 30% less for 2 turns"),
  ],
  rakshasa: [
    def("rakshasa_maya", "Maya", "shuffle", 2, 2, "the options shuffle twice, 2 questions"),
    def("rakshasa_veil", "Shadow Veil", "blind", 3, 2, "the options stay hidden for 3 seconds, 2 questions"),
    def("rakshasa_leech", "Soul Leech", "sap", 0.4, 0, "your ultimate meter loses 40%"),
  ],
  naga: [
    def("naga_venom", "Deadly Venom", "dot", 2, 2, "-2 hearts after each of the next 2 questions"),
    def("naga_gaze", "Hypnotic Gaze", "clock", 0.5, 2, "half the time on the next 2 questions"),
    def("naga_constrict", "Constrict", "lock", 1, 2, "Heavy is locked for 2 turns", ["heavy"]),
  ],
  simurgh: [
    def("simurgh_wind", "Searing Wind", "dot", 1, 2, "-1 heart after each of the next 2 questions"),
    def("simurgh_storm", "Feather Storm", "fog", 3, 2, "the question is blurred for 3 seconds, 2 questions"),
    def("simurgh_gaze", "Ageless Gaze", "clock", 0.5, 2, "half the time on the next 2 questions"),
  ],
  jormungandr: [
    def("jormungandr_venom", "World Venom", "dot", 1, 4, "-1 heart after each of the next 4 questions"),
    def("jormungandr_tide", "Tidal Crush", "lock", 1, 2, "one of your moves is locked for 2 turns", ["random"]),
    def("jormungandr_weight", "Ocean's Weight", "weaken", 0.3, 3, "your hits deal 30% less for 3 turns"),
  ],
};

/** Each creature's enraged signature blow: its form at full fury (the hydra strikes with every head at once). */
export const FURY: Readonly<Record<string, { name: string; mult: number; text: string; hits: number }>> = {
  hydra: { name: "All Heads Strike", mult: 2, hits: 5, text: "every head strikes at once" },
  kraken: { name: "Maelstrom", mult: 2, hits: 3, text: "the tentacles drag you down" },
  sphinx: { name: "Judgement of Ages", mult: 2, hits: 1, text: "the Sphinx passes judgement" },
  kitsune: { name: "Nine Foxfires", mult: 2, hits: 3, text: "nine fires dance around you" },
  fenrir: { name: "Unchained Frenzy", mult: 2, hits: 3, text: "a storm of claws and fangs" },
  ammit: { name: "Final Judgement", mult: 2, hits: 2, text: "the heart is weighed and found wanting" },
  minotaur: { name: "Labyrinth Rampage", mult: 2, hits: 2, text: "it charges again and again" },
  cyclops: { name: "Mountain Hurl", mult: 2.5, hits: 1, text: "a whole hillside, thrown" },
  oni: { name: "Thunder Drum", mult: 2, hits: 3, text: "every beat is a blow" },
  rakshasa: { name: "Thousand Forms", mult: 2, hits: 3, text: "it strikes from every side" },
  naga: { name: "Hood of Death", mult: 2, hits: 2, text: "all its hoods strike" },
  simurgh: { name: "Wings of the World", mult: 2, hits: 2, text: "a hurricane of feathers" },
  jormungandr: { name: "World Ending", mult: 2, hits: 2, text: "the World Serpent crashes down" },
};
export const FURY_EVERY = 3;

const ALL = new Map<string, EffectDef>([...POOL, ...Object.values(UNIQUE).flat()].map((e) => [e.id, e]));
export const effectById = (id: unknown): EffectDef | undefined => ALL.get(String(id ?? ""));
const species = (boss: Boss) => String(boss.species ?? "");

/** At the start of a fight: the two or three shared effects this boss carries in its normal form (not two alike). */
export function drawPool(rng: Rng = Math.random): string[] {
  const n = rng() < 0.5 ? 2 : 3;
  const out: EffectDef[] = [];
  for (const e of [...POOL].sort(() => rng() - 0.5)) {
    if (out.length >= n) break;
    if (!out.some((o) => o.kind === e.kind)) out.push(e);
  }
  return out.map((e) => e.id);
}

/** Set a boss up with its effects (its own pool draw; its unique ones come from its creature). */
export function initEffects(boss: Boss, rng: Rng = Math.random): void {
  boss.effects = { pool: drawPool(rng), unique: (UNIQUE[species(boss)] ?? []).map((e) => e.id) };
  boss.player_effects = [];
}

const NORMAL_CHANCE = 0.35, ENRAGED_CHANCE = 0.6;
/**
 * The effect a blow carries (or none): normal form, one of its shared ones now and then; enraged, one of its own
 * more often. Only blows that hurt carry one.
 */
export function chooseEffect(boss: Boss, damaging: boolean, rng: Rng = Math.random): EffectDef | null {
  if (!damaging || !boss.effects) return null;
  const enraged = !!boss.rage;
  if (rng() >= (enraged ? ENRAGED_CHANCE : NORMAL_CHANCE)) return null;
  const ids: string[] = enraged && boss.effects.unique?.length ? boss.effects.unique : boss.effects.pool ?? [];
  const e = ids.length ? effectById(pick(ids, rng)) : undefined;
  return e ?? null;
}

/** Put an effect on an intent (telegraphed: the player sees it coming). */
export function attach(intent: Intent, e: EffectDef | null): Intent {
  if (!e) return intent;
  return { ...intent, effect: { id: e.id, name: e.name, kind: e.kind, text: e.text }, description: `${intent.description} On a miss: ${e.name} (${e.text}).` } as Intent;
}

/** The enraged signature blow, every few turns while it rages. It always carries one of the creature's own effects. */
export function furyIntent(boss: Boss, base: number, turn: number, rng: Rng = Math.random): Intent | null {
  const f = FURY[species(boss)];
  if (!boss.rage || !f || turn % FURY_EVERY) return null;
  const value = Math.max(1, Math.round(base * f.mult));
  const own = (boss.effects?.unique ?? []).map(effectById).filter(Boolean) as EffectDef[];
  const intent: Intent = { kind: "fury", name: f.name, value, special: true, description: `Its enraged blow: ${f.text}, for ${value}. A right answer halves it; a right Guard blocks it.` };
  return attach({ ...intent, hits: f.hits } as Intent, own.length ? pick(own, rng) : null);
}

const MOVES = ["strike", "jab", "heavy", "guard"];
/** What a landed effect changes at once: the ultimate meter (sap), Focus (drain). The rest goes on the champion. */
export function land(boss: Boss, e: EffectDef, rng: Rng = Math.random): { sapped: number; drained: number } {
  const list: ActiveEffect[] = (boss.player_effects ??= []);
  if (e.kind === "sap") {
    const kit = boss.kit;
    const before = Number(kit?.meter ?? 0);
    if (kit) kit.meter = Math.max(0, Math.round(before * (1 - e.power)));
    return { sapped: before - Number(kit?.meter ?? 0), drained: 0 };
  }
  if (e.kind === "drain") return { sapped: 0, drained: e.power };
  const moves = e.moves?.includes("random") ? [pick(MOVES.filter((m) => m !== "guard"), rng)] : e.moves;
  const active: ActiveEffect = { id: e.id, name: e.name, kind: e.kind, power: e.power, turns: e.turns, text: e.text,
    ...(moves ? { moves } : {}), ...(UNIQUE[species(boss)]?.some((u) => u.id === e.id) ? { boss: true } : {}) };
  const same = list.findIndex((a) => a.id === e.id);
  if (same >= 0) list[same] = active; else list.push(active);
  return { sapped: 0, drained: 0 };
}

/** After a question: damage-over-time ticks, every effect counts down, the spent ones go. */
export function tick(boss: Boss): { damage: number; ticked: { id: string; name: string; damage: number }[]; expired: string[] } {
  const list: ActiveEffect[] = boss.player_effects ?? [];
  const ticked: { id: string; name: string; damage: number }[] = [];
  const expired: string[] = [];
  let damage = 0;
  for (const a of list) {
    if (a.kind === "dot") { damage += a.power; ticked.push({ id: a.id, name: a.name, damage: a.power }); }
    a.turns -= 1;
    if (a.turns <= 0) expired.push(a.name);
  }
  boss.player_effects = list.filter((a) => a.turns > 0);
  return { damage, ticked, expired };
}

const active = (boss: Boss): ActiveEffect[] => boss.player_effects ?? [];
/** The moves the effects on the champion lock now. */
export const lockedMoves = (boss: Boss): string[] => [...new Set(active(boss).filter((a) => a.kind === "lock").flatMap((a) => a.moves ?? []))];
/** How fast the answer clock runs: frozen or slowed (the strongest wins), and a little faster while the boss rages. */
export const clockFactor = (boss: Boss): number =>
  Math.min(1, ...active(boss).filter((a) => a.kind === "clock").map((a) => a.power)) * (boss.rage ? RAGE_CLOCK : 1);
export const RAGE_CLOCK = 0.85;
/** Your hits' multiplier under Weaken (the strongest wins). */
export const weakenMult = (boss: Boss): number => 1 - Math.max(0, ...active(boss).filter((a) => a.kind === "weaken").map((a) => a.power));
export const silenced = (boss: Boss) => active(boss).some((a) => a.kind === "silence");
export const cursed = (boss: Boss) => active(boss).some((a) => a.kind === "curse");
/** What the question screen does under the effects: hidden options, a blurred question, reshuffles. */
export function questionFx(boss: Boss): { blind: number; fog: number; shuffle: number } | null {
  const of = (kind: EffectKind) => Math.max(0, ...active(boss).filter((a) => a.kind === kind).map((a) => a.power));
  const fx = { blind: of("blind"), fog: of("fog"), shuffle: of("shuffle") };
  return fx.blind || fx.fog || fx.shuffle ? fx : null;
}
/** The effects on the champion, for the HUD. */
export const hud = (boss: Boss) => active(boss).map((a) => ({ id: a.id, name: a.name, kind: a.kind, turns: a.turns, text: a.text, ...(a.moves ? { moves: a.moves } : {}), ...(a.boss ? { boss: true } : {}) }));
