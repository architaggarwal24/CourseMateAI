// Creature signature mechanics (port of backend/core_brains/mechanics.py): one rule set per creature. The battle
// builds a Turn for every answer: prepare() before the player's hit lands, settle() after the boss's intent, and
// scheduled() says whether the coming turn has a special intent. Numbers are per difficulty (easy..nightmare).
import { intentBaseDamage, pick, type Boss, type Intent, type Rng } from "./boss";

const DI: Record<string, number> = { easy: 0, medium: 1, hard: 2, nightmare: 3 };
const HYDRA_HEAL_PCT = [3, 4, 6, 8], HYDRA_MAX_HEADS = 3;
const KRAKEN_EVERY = 4, KRAKEN_LOCK_TURNS = [1, 1, 2, 2];
const SPHINX_EVERY = 3, RIDDLE_MULT = 1.5;
const KITSUNE_EVERY = 3, ILLUSION_FOCUS_COST = 2;
const FENRIR_DIVISOR = [3, 2, 2, 2], FENRIR_CAP = [1, 2, 2, 3], FENRIR_CHAIN = 3;
const AMMIT_HEAL_PCT = [5, 6, 8, 10], AMMIT_MAX_STACKS = 3, FEATHER_MULT = 2;
const MINOTAUR_EVERY = 4, STUN_MULT = 1.5;
const CYCLOPS_EVERY = 4, THROW_MULT = 3;
const ONI_MAX_DRUM = [2, 2, 3, 3];
const RAKSHASA_EVERY = 3, RAKSHASA_SHIELD_PCT = 0.05;
const NAGA_EVERY = 4, TREASURE_MULT = 1.5, TREASURE_HEARTS = 1, TREASURE_FOCUS = 2, VENOM_TURNS = 2;
const SIMURGH_HEAL_PCT = [2, 3, 4, 5], SIMURGH_SLOW = 0.5, FEATHER_PLUCK_MULT = 1.25;
const COIL_CAP = [1, 1, 2, 3];

export const DAMAGING_KINDS = ["attack", "heavy", "grab", "riddle", "illusion", "charge", "throw", "hoard"];
export const key = (text: unknown) => String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const d = (difficulty: string) => DI[difficulty] ?? 2;
const fmt = (n: number) => String(n);
type State = Record<string, any>;

export class Turn {
  dealt = 0; mult = 1; noHalve = false; bossBonus = 0; dodge = false; skip = false; bossHeal = 0; playerDot = 0;
  focusDelta = 0; hearts = 0; shield = 0; newWeakness: string | null = null;
  events: Record<string, unknown>[] = [];
  constructor(public o: {
    difficulty: string; boss: Boss; state: State; intent: Intent; move: string; correct: boolean; timedOut?: boolean; turn?: number;
    combo?: number; conceptKey?: string; spentRatio?: number; illusionPicked?: boolean; poolConcepts?: string[]; rng?: Rng;
  }) {}
  get difficulty() { return this.o.difficulty; } get boss() { return this.o.boss; } get state() { return this.o.state; }
  get intent() { return this.o.intent; } get move() { return this.o.move; } get correct() { return this.o.correct; }
  get timedOut() { return !!this.o.timedOut; } get turn() { return this.o.turn ?? 1; } get combo() { return this.o.combo ?? 0; }
  get conceptKey() { return this.o.conceptKey ?? ""; } get spentRatio() { return this.o.spentRatio ?? 0; }
  get illusionPicked() { return !!this.o.illusionPicked; } get poolConcepts() { return this.o.poolConcepts ?? []; }
  get rng() { return this.o.rng ?? Math.random; }
  get d() { return d(this.difficulty); }
  event(type: string, text: string, extra: Record<string, unknown> = {}) { this.events.push({ type, text, ...extra }); }
  healPct(pct: number) {
    const hp = Number(this.boss.current_hp ?? 0), top = Number(this.boss.max_hp ?? 100);
    return hp <= 0 ? 0 : Math.max(0, Math.min(Math.round((top * pct) / 100), top - hp));
  }
}

const special = (kind: string, name: string, value: number, description: string): Intent => ({ kind, name, value: Math.trunc(value), description, special: true });
const base = (boss: Boss, difficulty: string) => intentBaseDamage(boss, difficulty);

export abstract class Mechanic {
  abstract id: string; abstract name: string; abstract summary: string;
  init(_boss: Boss, _difficulty: string): State { return {}; }
  scheduled(_s: State, _boss: Boss, _difficulty: string, _turn: number): Intent | null { return null; }
  lockedMoves(_s: State): string[] { return []; }
  blocksInsight(_i: Intent | null): boolean { return false; }
  wantsIllusion(_i: Intent | null): boolean { return false; }
  forcedTier(_i: Intent | null): string | null { return null; }
  prefersRiddle(_i: Intent | null): boolean { return false; }
  prepare(_t: Turn): void {}
  settle(_t: Turn): void {}
  counters(_s: State, _boss: Boss, _difficulty: string): Record<string, unknown>[] { return []; }
  hud(s: State, boss: Boss, difficulty: string) {
    return { id: this.id, name: this.name, summary: this.summary, counters: this.counters(s, boss, difficulty), locked_moves: this.lockedMoves(s) };
  }
}

class Hydra extends Mechanic {
  id = "regrowth"; name = "Regrowth"; summary = "Every miss grows a head, and each head heals it. A right Heavy burns them away.";
  init() { return { heads: 0 }; }
  settle(t: Turn) {
    if (t.correct && t.move === "heavy") {
      if (t.state.heads) t.event("cauterized", "Your heavy blow burns the stumps: no head grows back.");
      t.state.heads = 0;
    } else if (!t.correct) {
      t.state.heads = Math.min(HYDRA_MAX_HEADS, Number(t.state.heads ?? 0) + 1);
      t.bossHeal = t.healPct(HYDRA_HEAL_PCT[t.d] * t.state.heads);
      t.event("regrowth", `A head grows back. The Hydra heals ${t.bossHeal}.`, { heads: t.state.heads });
    }
  }
  counters(s: State, _b: Boss, difficulty: string) {
    return [{ label: "Heads", value: Number(s.heads ?? 0), max: HYDRA_MAX_HEADS, hint: `Each heals ${HYDRA_HEAL_PCT[d(difficulty)]}% on a miss` }];
  }
}

class Kraken extends Mechanic {
  id = "grab"; name = "Tentacle Grab"; summary = "Every 4th turn it grabs. Miss that turn and the move you used is locked. A right answer breaks free.";
  init() { return { locked: null }; }
  scheduled(_s: State, boss: Boss, difficulty: string, turn: number) {
    if (turn % KRAKEN_EVERY) return null;
    const v = base(boss, difficulty), n = KRAKEN_LOCK_TURNS[d(difficulty)];
    return special("grab", "Tentacle Grab", v, `Hits for ${v}. Miss and the move you used is locked for ${n} turn${n > 1 ? "s" : ""}. A right answer breaks free.`);
  }
  lockedMoves(s: State) { const l = s.locked; return l && (l.turns ?? 0) > 0 ? [l.move] : []; }
  settle(t: Turn) {
    const lock = t.state.locked;
    if (lock) { lock.turns = Number(lock.turns ?? 0) - 1; t.state.locked = lock.turns > 0 ? lock : null; }
    if (t.intent.kind !== "grab") return;
    if (t.correct) t.event("broke_free", "You slip out of the tentacles.");
    else {
      const move = t.move === "guard" ? "strike" : t.move;
      t.state.locked = { move, turns: KRAKEN_LOCK_TURNS[t.d] };
      t.event("grabbed", `The Kraken pins your ${title(move)}.`, { move, turns: KRAKEN_LOCK_TURNS[t.d] });
    }
  }
  counters(s: State) {
    const l = s.locked;
    return l ? [{ label: `${title(l.move)} locked`, value: Number(l.turns), max: 2, hint: "Turns until it lets go" }] : [];
  }
}

class Sphinx extends Mechanic {
  id = "riddle"; name = "Riddle"; summary = "Every 3rd question is a riddle: right hits x1.5 and gives Focus, wrong hurts more. No Insight on riddles.";
  scheduled(_s: State, boss: Boss, difficulty: string, turn: number) {
    if (turn % SPHINX_EVERY) return null;
    const v = Math.ceil(base(boss, difficulty) * RIDDLE_MULT);
    return special("riddle", "The Sphinx's Riddle", v, `A riddle. Right: x${fmt(RIDDLE_MULT)} damage and +1 Focus. Wrong: it strikes for ${v}. Insight can't be cast on it.`);
  }
  blocksInsight(i: Intent | null) { return i?.kind === "riddle"; }
  prefersRiddle(i: Intent | null) { return i?.kind === "riddle"; }
  prepare(t: Turn) { if (t.intent.kind === "riddle" && t.correct) t.mult = RIDDLE_MULT; }
  settle(t: Turn) {
    if (t.intent.kind !== "riddle") return;
    if (t.correct) { t.focusDelta += 1; t.event("riddle_solved", "Riddle solved: the Sphinx bows its head."); }
    else t.event("riddle_failed", "Wrong. The Sphinx devours your certainty.");
  }
}

class Kitsune extends Mechanic {
  id = "illusion"; name = "Fox-fire Illusion"; summary = "Every 3rd question hides a fake option. Believe it and you lose 2 Focus. Insight clears it first.";
  scheduled(_s: State, boss: Boss, difficulty: string, turn: number) {
    if (turn % KITSUNE_EVERY) return null;
    const v = base(boss, difficulty);
    return special("illusion", "Fox-fire Illusion", v, `One option is an illusion. Pick it and lose ${ILLUSION_FOCUS_COST} Focus; it hits for ${v}.`);
  }
  wantsIllusion(i: Intent | null) { return i?.kind === "illusion"; }
  settle(t: Turn) {
    if (t.illusionPicked) { t.focusDelta -= ILLUSION_FOCUS_COST; t.event("illusion", "It was an illusion! The fox laughs and steals your Focus."); }
    else if (t.intent.kind === "illusion" && t.correct) t.event("illusion_seen", "You see through the illusion.");
  }
}

/** A fake option for a Kitsune turn: another question's right answer, never one of the real options. */
export function illusionOption(options: string[], poolAnswers: string[], rng: Rng = Math.random): string | null {
  const real = new Set(options.map(key));
  const choices = [...new Set(poolAnswers)].filter((a) => a && !real.has(key(a)));
  return choices.length ? pick(choices, rng) : null;
}

class Fenrir extends Mechanic {
  id = "unchained"; name = "Unchained"; summary = "Fury grows every turn and makes its blows harder. Three right answers in a row chain it again.";
  init() { return { fury: 0 }; }
  static bonus(fury: number, dd: number) { return Math.min(FENRIR_CAP[dd], Math.floor(fury / FENRIR_DIVISOR[dd])); }
  prepare(t: Turn) { t.bossBonus += Fenrir.bonus(Number(t.state.fury ?? 0), t.d); }
  settle(t: Turn) {
    if (t.correct && t.combo >= FENRIR_CHAIN && t.combo % FENRIR_CHAIN === 0) { t.state.fury = 0; t.event("chained", "Three in a row: Fenrir is chained again!"); }
    else t.state.fury = Number(t.state.fury ?? 0) + 1;
  }
  counters(s: State, _b: Boss, difficulty: string) {
    const dd = d(difficulty);
    return [{ label: "Fury", value: Number(s.fury ?? 0), max: FENRIR_CAP[dd] * FENRIR_DIVISOR[dd], hint: `+${Fenrir.bonus(Number(s.fury ?? 0), dd)} damage on its blows` }];
  }
}

class Ammit extends Mechanic {
  id = "devourer"; name = "Devourer of Hearts"; summary = "Miss a concept you missed before and it feeds. Get one right and your heart is lighter than the feather: x2.";
  init(boss: Boss) { return { missed: (boss.target_concepts ?? []).map(key).filter(Boolean), stacks: 0 }; }
  private seen(t: Turn) { return !!t.conceptKey && (t.state.missed ?? []).includes(t.conceptKey); }
  prepare(t: Turn) { t.bossBonus += Number(t.state.stacks ?? 0); if (t.correct && this.seen(t)) t.mult = FEATHER_MULT; }
  settle(t: Turn) {
    if (t.correct) { if (this.seen(t)) t.event("feather", "Your heart is lighter than the feather: double damage!"); return; }
    if (this.seen(t)) {
      t.state.stacks = Math.min(AMMIT_MAX_STACKS, Number(t.state.stacks ?? 0) + 1);
      t.bossHeal = t.healPct(AMMIT_HEAL_PCT[t.d]);
      t.event("devour", `Ammit devours a repeated mistake and heals ${t.bossHeal}.`);
    } else if (t.conceptKey) (t.state.missed ??= []).push(t.conceptKey);
  }
  counters(s: State) { return [{ label: "Feasts", value: Number(s.stacks ?? 0), max: AMMIT_MAX_STACKS, hint: "+1 damage on its blows each" }]; }
}

class Minotaur extends Mechanic {
  id = "labyrinth_charge"; name = "Labyrinth Charge"; summary = "Every 4th turn it charges, harder the longer the fight lasts. A right Guard stuns it.";
  init() { return { stun_next: false }; }
  scheduled(s: State, boss: Boss, difficulty: string, turn: number) {
    if (s.stun_next) return special("stunned", "Stunned", 0, `It is dazed: it does nothing and your hit lands x${fmt(STUN_MULT)}.`);
    if (turn % MINOTAUR_EVERY) return null;
    const v = base(boss, difficulty) + Math.floor(turn / 2);
    return special("charge", "Labyrinth Charge", v, `Charges for ${v}: a right answer does not halve it. A right Guard stuns it.`);
  }
  prepare(t: Turn) {
    if (t.intent.kind === "charge") t.noHalve = true;
    else if (t.intent.kind === "stunned") { t.skip = true; if (t.correct) t.mult = STUN_MULT; }
  }
  settle(t: Turn) {
    if (t.intent.kind === "stunned") t.state.stun_next = false;
    else if (t.intent.kind === "charge" && t.correct && t.move === "guard") { t.state.stun_next = true; t.event("stunned", "The Minotaur crashes into your guard and staggers!"); }
  }
  counters(s: State) { return s.stun_next ? [{ label: "Stunned", value: 1, max: 1, hint: "Next turn it does nothing" }] : []; }
}

class Cyclops extends Mechanic {
  id = "boulder"; name = "Boulder Throw"; summary = "It takes aim, then throws a boulder that a right answer can't halve. Guard or a right Jab dodges it.";
  scheduled(_s: State, boss: Boss, difficulty: string, turn: number) {
    if (turn % CYCLOPS_EVERY === CYCLOPS_EVERY - 1) return special("aim", "Takes Aim", 0, "It lifts a boulder. Next turn it throws: Guard or Jab to dodge.");
    if (turn % CYCLOPS_EVERY === 0) {
      const v = THROW_MULT * base(boss, difficulty);
      return special("throw", "Boulder Throw", v, `Throws for ${v}. A right answer can't halve it; a right Guard or Jab dodges it.`);
    }
    return null;
  }
  prepare(t: Turn) {
    if (t.intent.kind === "aim") t.skip = true;
    else if (t.intent.kind === "throw") { t.noHalve = true; if (t.correct && (t.move === "guard" || t.move === "jab")) t.dodge = true; }
  }
  settle(t: Turn) { if (t.intent.kind === "throw" && t.dodge) t.event("dodged", "You dodge the boulder!"); }
}

class Oni extends Mechanic {
  id = "war_drum"; name = "War Drum"; summary = "Every turn it takes no damage it beats the drum: +1 damage per beat. A right Heavy breaks it.";
  init() { return { drum: 0 }; }
  prepare(t: Turn) { t.bossBonus += Number(t.state.drum ?? 0); }
  settle(t: Turn) {
    if (t.correct && t.move === "heavy") { if (t.state.drum) t.event("drum_broken", "Your heavy blow splits the war drum!"); t.state.drum = 0; }
    else if (t.dealt <= 0) {
      t.state.drum = Math.min(ONI_MAX_DRUM[t.d], Number(t.state.drum ?? 0) + 1);
      t.event("drum", "BOOM. The war drum beats faster.", { drum: t.state.drum });
    }
  }
  counters(s: State, _b: Boss, difficulty: string) { return [{ label: "Drum", value: Number(s.drum ?? 0), max: ONI_MAX_DRUM[d(difficulty)], hint: "+1 damage each" }]; }
}

class Rakshasa extends Mechanic {
  id = "shapeshift"; name = "Shapeshift"; summary = "Every 3rd turn it changes form: its weakness moves to another concept, and it raises a small shield.";
  settle(t: Turn) {
    if (t.turn % RAKSHASA_EVERY) return;
    const current = key(t.boss.weakness);
    const choices = [...new Set(t.poolConcepts.filter((c) => key(c) && key(c) !== current))].sort();
    if (!choices.length) return;
    t.newWeakness = pick(choices, t.rng);
    t.shield = Math.max(1, Math.round(Number(t.boss.max_hp ?? 100) * RAKSHASA_SHIELD_PCT));
    t.event("shapeshift", `The Rakshasa changes form. Its weakness is now: ${t.newWeakness}.`, { weakness: t.newWeakness });
  }
  counters(_s: State, boss: Boss) { return [{ label: "Weak to", text: String(boss.weakness || "?"), hint: "Changes every 3 turns" }]; }
}

class Naga extends Mechanic {
  id = "hoard"; name = "Serpent's Hoard"; summary = "Every 4th turn is a hard treasure question: right steals a heart and Focus, wrong poisons you.";
  init() { return { venom: 0 }; }
  scheduled(_s: State, boss: Boss, difficulty: string, turn: number) {
    if (turn % NAGA_EVERY) return null;
    const v = base(boss, difficulty);
    return special("hoard", "The Hoard", v, `A hard treasure question. Right: x${fmt(TREASURE_MULT)} damage, +${TREASURE_HEARTS} heart, +${TREASURE_FOCUS} Focus. Wrong: venom for ${VENOM_TURNS} turns.`);
  }
  forcedTier(i: Intent | null) { return i?.kind === "hoard" ? "hard" : null; }
  prepare(t: Turn) { if (t.intent.kind === "hoard" && t.correct) t.mult = TREASURE_MULT; }
  settle(t: Turn) {
    const venom = Number(t.state.venom ?? 0);
    if (venom > 0) { t.playerDot += 1; t.state.venom = venom - 1; t.event("venom", "The venom burns: -1 heart."); }
    if (t.intent.kind !== "hoard") return;
    if (t.correct) { t.hearts += TREASURE_HEARTS; t.focusDelta += TREASURE_FOCUS; t.event("treasure", "You steal from the hoard!"); }
    else { t.state.venom = VENOM_TURNS; t.event("poisoned", `Venom! You lose a heart on each of the next ${VENOM_TURNS} turns.`); }
  }
  counters(s: State) { return s.venom ? [{ label: "Venom", value: Number(s.venom), max: VENOM_TURNS, hint: "-1 heart per turn" }] : []; }
}

class Simurgh extends Mechanic {
  id = "wisdom"; name = "Feathers of Wisdom"; summary = "Slow answers (over half the clock) let it heal. Fast right answers pluck a feather: +25% damage.";
  prepare(t: Turn) { if (t.correct && !t.timedOut && t.spentRatio < SIMURGH_SLOW) t.mult = FEATHER_PLUCK_MULT; }
  settle(t: Turn) {
    if (t.timedOut || t.spentRatio > SIMURGH_SLOW) { t.bossHeal = t.healPct(SIMURGH_HEAL_PCT[t.d]); t.event("wisdom", `While you think, the Simurgh gathers wisdom and heals ${t.bossHeal}.`); }
    else if (t.correct) t.event("plucked", "Quick as thought: you pluck a feather!");
  }
}

class Jormungandr extends Mechanic {
  id = "coil"; name = "World Coil"; summary = "Every miss wraps another coil around you (1 damage a turn each). Right Strikes shake one off, a right Guard all.";
  init() { return { coils: 0 }; }
  settle(t: Turn) {
    let coils = Number(t.state.coils ?? 0);
    if (coils) { t.playerDot += coils; t.event("squeeze", `The coils squeeze: -${coils}.`); }
    if (!t.correct) coils = Math.min(COIL_CAP[t.d], coils + 1);
    else if (t.move === "guard") { if (coils) t.event("uncoiled", "You throw off every coil!"); coils = 0; }
    else if ((t.move === "strike" || t.move === "heavy") && coils) { coils -= 1; t.event("uncoil", "You shake off a coil."); }
    t.state.coils = coils;
  }
  counters(s: State, _b: Boss, difficulty: string) { return [{ label: "Coils", value: Number(s.coils ?? 0), max: COIL_CAP[d(difficulty)], hint: "-1 heart per turn each" }]; }
}

export const MECHANICS: Record<string, Mechanic> = {
  hydra: new Hydra(), kraken: new Kraken(), sphinx: new Sphinx(), kitsune: new Kitsune(), fenrir: new Fenrir(), ammit: new Ammit(),
  minotaur: new Minotaur(), cyclops: new Cyclops(), oni: new Oni(), rakshasa: new Rakshasa(), naga: new Naga(), simurgh: new Simurgh(),
  jormungandr: new Jormungandr(),
};
export const forBoss = (boss: Boss): Mechanic | null => MECHANICS[String(boss.species ?? "")] ?? null;
