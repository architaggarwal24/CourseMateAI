// Boss combat rules (port of the rules half of backend/core_brains/boss_brain.py): HP ranges, the telegraphed
// intents and what a right answer hits for. The AI calls (questions, flavour, expedition acts) are in arenaAi.ts.
export type Boss = Record<string, any>;
export type Rng = () => number;

export const VALID_DIFFICULTIES = ["easy", "medium", "hard", "nightmare"] as const;
const HP_RANGE: Record<string, [number, number]> = { easy: [40, 80], medium: [70, 110], hard: [100, 160], nightmare: [140, 220] };

export const pick = <T,>(list: T[], rng: Rng = Math.random): T => list[Math.floor(rng() * list.length)];

/** Coerce boss fields into safe types and ranges. */
export function sanitizeBoss(boss: Boss, difficulty: string): Boss {
  const [lo, hi] = HP_RANGE[difficulty] ?? HP_RANGE.hard;
  const raw = boss.max_hp === null ? Number.NaN : Number(boss.max_hp ?? 0);
  boss.max_hp = Math.max(lo, Math.min(hi, Number.isFinite(raw) ? Math.trunc(raw) : Math.floor((lo + hi) / 2)));
  const rage = Number(boss.rage_threshold ?? 0.4);
  boss.rage_threshold = Math.max(0.2, Math.min(0.6, Number.isFinite(rage) ? rage : 0.4));
  for (const k of ["name", "title", "tagline", "personality", "conceptual_core", "special_ability", "weakness"]) {
    let v = boss[k] === null || boss[k] === undefined ? "" : String(boss[k]);
    if (k === "name" && !v.trim()) v = "The Guardian";
    boss[k] = v.slice(0, 200);
  }
  let names = boss.attack_names;
  if (!Array.isArray(names) || !names.some((n) => typeof n === "string" && n.trim())) names = ["Concept Crush", "Theory Slam", "Knowledge Void"];
  boss.attack_names = names.map((n: unknown) => String(n).slice(0, 80)).slice(0, 5);
  return boss;
}

const FLAVOR_KEYS = ["title", "conceptual_core", "weakness", "special_ability", "intro_taunt", "defeat_taunt"];
/** Lay a model's lines over a boss (in place). Combat numbers are never touched. */
export function mergeFlavor(boss: Boss, flavor: Record<string, any>): Boss {
  for (const k of FLAVOR_KEYS) if (flavor[k]) boss[k] = String(flavor[k]).slice(0, 200);
  const attacks = (flavor.attack_names ?? []).filter(Boolean);
  if (attacks.length >= 2) boss.attack_names = attacks.slice(0, 3).map((a: unknown) => String(a).slice(0, 80));
  for (const k of ["hit_taunts", "miss_taunts"]) {
    const lines = (flavor[k] ?? []).filter(Boolean).map((x: unknown) => String(x).slice(0, 160));
    if (lines.length) boss[k] = [...lines, ...(boss[k] ?? []).slice(0, 1)];
  }
  delete boss.flavor_pending;
  return boss;
}

// ── hits and taunts ──────────────────────────────────────────────────────────────────────────────────────────
/** What a right answer hits for (a perfect strike: x1.3), without touching the boss. `bonus`: Brak's Iron Combo. */
export function playerHit(boss: Boss, combo: number, bonus = 0) {
  const base = (boss.phase ?? 1) === 2 ? 35 : 25;
  return { damage: Math.max(Math.trunc((base + Math.min(combo, 5) * 3 + bonus) * 1.3), 1), hit_type: "PERFECT STRIKE" };
}

export function bossTaunt(boss: Boss, situation: string, rng: Rng = Math.random): string {
  const any = (list: unknown, d: string) => (Array.isArray(list) && list.length ? pick(list as string[], rng) : d);
  switch (situation) {
    case "phase_change": return any(boss.phase2_taunts, "ENOUGH! Now face my true power!");
    case "hit": return any(boss.hit_taunts, "Impressive...");
    case "miss": return any(boss.miss_taunts, "Pathetic!");
    case "defeat": return boss.defeat_taunt ?? "Impossible... defeated...";
    case "intro": return boss.intro_taunt ?? "Prepare yourself!";
    default: return any((boss.phase ?? 1) === 2 ? boss.phase2_taunts : boss.phase1_taunts, "Can you survive?");
  }
}

// ── intents ──────────────────────────────────────────────────────────────────────────────────────────────────
const DAMAGE: Record<string, { base: number; rage_base: number }> = {
  easy: { base: 1, rage_base: 1 }, medium: { base: 1, rage_base: 2 }, hard: { base: 2, rage_base: 3 }, nightmare: { base: 3, rage_base: 5 },
};
const INTENT_WEIGHTS: Record<number, Record<string, number>> = {
  1: { attack: 55, heavy: 10, shield: 20, drain: 15 },
  2: { attack: 35, heavy: 25, shield: 15, drain: 10, heal: 15 },
};
const SHIELD_PCT = 0.1;
const HEAL_PCT = 8;

export type Intent = { kind: string; name: string; value: number; description: string; amount?: number; special?: boolean };

export function intentBaseDamage(boss: Boss, difficulty: string): number {
  const s = DAMAGE[difficulty] ?? DAMAGE.hard;
  return boss.rage ? s.rage_base : s.base;
}

export function makeIntent(kind: string, boss: Boss, difficulty: string, shieldFactor = 1, rng: Rng = Math.random): Intent {
  const base = intentBaseDamage(boss, difficulty);
  const names = (boss.attack_names ?? []).filter(Boolean);
  switch (kind) {
    case "attack":
      return { kind, name: pick(names.length ? names : ["Attack"], rng), value: base, description: `Attacks for ${base}. A right answer halves it; Guard blocks it.` };
    case "heavy": {
      const value = 2 * base;
      return { kind, name: boss.special_ability || "Heavy Slam", value, description: `A heavy blow for ${value}. A right answer halves it; Guard blocks it.` };
    }
    case "shield": {
      const value = Math.max(1, Math.round((boss.max_hp ?? 100) * SHIELD_PCT * shieldFactor));
      return { kind, name: "Barrier", value, description: `Raises a shield absorbing ${value} damage. Weakness hits ignore shields.` };
    }
    case "drain":
      return { kind, name: "Mind Drain", value: 0, description: "A wrong answer (or running out of time) drains all your Focus." };
    case "heal": {
      const amount = Math.max(1, Math.round(((boss.max_hp ?? 100) * HEAL_PCT) / 100));
      return { kind, name: "Regenerate", value: HEAL_PCT, amount, description: `Heals ${HEAL_PCT}% (${amount} HP) unless a right Strike or Heavy interrupts it.` };
    }
    default: throw new Error(`unknown intent ${kind}`);
  }
}

export function rollIntent(boss: Boss, difficulty: string, shieldFactor = 1, rng: Rng = Math.random): Intent {
  const table = INTENT_WEIGHTS[(boss.phase ?? 1) === 2 ? 2 : 1];
  const kinds = Object.keys(table);
  let r = rng() * kinds.reduce((a, k) => a + table[k], 0);
  let kind = kinds[kinds.length - 1];
  for (const k of kinds) { if (r < table[k]) { kind = k; break; } r -= table[k]; }
  return makeIntent(kind, boss, difficulty, shieldFactor, rng);
}
