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
