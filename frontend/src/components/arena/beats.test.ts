import { describe, expect, it } from "vitest";
import type { Battle, Outcome } from "@/lib/arena/types";
import { beatsFor } from "./BattleScreen";

const base: Outcome = { question_id: 1, correct: true, timed_out: false, answer: "A", correct_answer: "A", damage_dealt: 10, damage_taken: 0, combo: 1 };
const active = { status: "active" } as Battle;
const kinds = (o: Partial<Outcome>, b: Partial<Battle> = {}) => beatsFor({ ...base, ...o }, { ...active, ...b } as Battle).map((x) => x.kind);

describe("what the pixel stage plays for a verdict", () => {
  it("a right answer: your strike; a heavy weakness hit is heavy and critical", () => {
    expect(kinds({})).toEqual(["hero-strike"]);
    expect(beatsFor({ ...base, move: "heavy", weakness: true }, active)[0]).toMatchObject({ heavy: true, crit: true });
  });
  it("a wrong answer: the boss strikes; a guard shows a block", () => {
    expect(kinds({ correct: false, damage_dealt: 0, damage_taken: 4, intent: { kind: "attack" } as never })).toEqual(["boss-strike"]);
    expect(beatsFor({ ...base, damage_dealt: 0, blocked: true }, active)).toEqual([{ kind: "boss-strike", blocked: true }]);
  });
  it("the boss's non-attack intents, the rage, and both kinds of KO", () => {
    expect(kinds({ correct: false, damage_dealt: 0, intent: { kind: "shield" } as never })).toEqual(["boss-shield"]);
    expect(kinds({ phase_changed: true, damage_taken: 2 })).toEqual(["hero-strike", "rage", "boss-strike"]);
    expect(kinds({}, { status: "won" })).toEqual(["hero-strike", "boss-ko"]);
    expect(kinds({ correct: false, damage_dealt: 0, damage_taken: 5 }, { status: "lost" })).toEqual(["boss-strike", "hero-ko"]);
  });
  it("a blow fully absorbed by a shield still swings, at the shield", () => {
    expect(beatsFor({ ...base, damage_dealt: 0, shield_absorbed: 6 }, active)[0]).toMatchObject({ kind: "hero-strike", shielded: true });
  });
});

// ── Phase 3 Stage 2: mechanic and kit beats ─────────────────────────────────────────────────────────────────────
const mech = (...types: string[]) => ({ id: "x", events: types.map((type) => ({ type, text: type })), boss_healed: 0, damage: 0, hearts: 0, focus: 0, shield: 0, illusion_picked: false, hud: null });
const kit = (...types: string[]) => ({ events: types.map((type) => ({ type, text: type })), refund: 0, hud: null as never });
const effects = (beats: ReturnType<typeof beatsFor>) => beats.map((b) => (b.kind === "mechanic" ? `fx:${b.effect}` : b.kind));

describe("mechanic and kit beats", () => {
  it("a boosted blow: the boost plays first, then the strike and what it set off", () => {
    const o = { ...base, mechanic: mech("feather"), kit: kit("ultimate_hit") };
    expect(effects(beatsFor(o, active))).toEqual(["fx:feather", "fx:ultimate_hit", "hero-strike"]);
    expect(effects(beatsFor({ ...base, mechanic: mech("chained") }, active))).toEqual(["hero-strike", "fx:chained"]);
  });
  it("a miss on a grab: the blow lands, then the tentacle pins you", () => {
    const o = { ...base, correct: false, damage_dealt: 0, damage_taken: 3, intent: { kind: "grab" } as never, mechanic: mech("grabbed") };
    expect(effects(beatsFor(o, active))).toEqual(["boss-strike", "fx:grabbed"]);
  });
  it("a charge is a rush, a throw is a boulder; a right Guard on a charge staggers the Minotaur", () => {
    expect(beatsFor({ ...base, correct: false, damage_dealt: 0, damage_taken: 4, intent: { kind: "charge" } as never }, active)[0]).toMatchObject({ kind: "boss-strike", charge: true });
    expect(beatsFor({ ...base, correct: false, damage_dealt: 0, damage_taken: 4, intent: { kind: "throw" } as never }, active)[0]).toMatchObject({ kind: "boss-strike", projectile: true });
    const guard = { ...base, damage_dealt: 0, blocked: true, intent: { kind: "charge" } as never, mechanic: mech("stunned") };
    expect(effects(beatsFor(guard, active))).toEqual(["boss-strike", "fx:stunned"]);
  });
  it("a dodge replaces the boss's blow (and keeps a thrown boulder's flight)", () => {
    expect(effects(beatsFor({ ...base, damage_dealt: 0, dodged: true }, active))).toEqual(["dodge"]);
    const thrown = beatsFor({ ...base, correct: true, damage_dealt: 0, intent: { kind: "throw" } as never, mechanic: mech("dodged") }, active);
    expect(thrown).toEqual([{ kind: "dodge", projectile: true }]);
    expect(effects(beatsFor({ ...base, damage_dealt: 0, kit: kit("vanish") }, active))).toEqual(["dodge"]);
  });
  it("Riposte follows the blocked blow; the creature's own move comes after the exchange", () => {
    const o = { ...base, damage_dealt: 0, blocked: true, riposte: 3, mechanic: mech("regrowth") };
    expect(effects(beatsFor(o, active))).toEqual(["boss-strike", "riposte", "fx:regrowth"]);
  });
  it("a KO ends it: no boss move after the boss falls; an unknown event plays nothing", () => {
    expect(effects(beatsFor({ ...base, mechanic: mech("chained", "regrowth") }, { status: "won" } as Battle))).toEqual(["hero-strike", "fx:chained", "boss-ko"]);
    expect(effects(beatsFor({ ...base, mechanic: mech("something_new") }, active))).toEqual(["hero-strike"]);
  });
});
