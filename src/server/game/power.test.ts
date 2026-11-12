import { describe, expect, it } from "vitest";
import { bossPower, huntPower, matchBoss, powerFrom } from "./power";
import { rushPlan, survivalTarget } from "./gauntlet";

describe("power level and boss matching (Stage 6)", () => {
  it("power: a base, the five best score cards (/40), and each creature hunted by its tier", () => {
    expect(powerFrom([], [])).toEqual({ power: 10, from_score: 0, from_hunts: 0 });
    // the five best of six count: (4000+3000+2000+2000+1000)/5 = 2400 -> 60
    expect(powerFrom([1000, 4000, 2000, 3000, 2000, 100], [])).toMatchObject({ from_score: 60 });
    expect(huntPower("minotaur")).toBe(5);
    expect(huntPower("simurgh")).toBe(20);
    expect(powerFrom([], ["minotaur", "hydra", "simurgh"])).toMatchObject({ from_hunts: 5 + 14 + 20, power: 10 + 39 });
  });

  it("a boss's power is its tier x its difficulty x its HP", () => {
    expect(bossPower("minotaur", "medium")).toBe(20);
    expect(bossPower("simurgh", "nightmare")).toBe(136);
    expect(bossPower("hydra", "hard", 1.5)).toBe(107);
  });

  it("matching picks the creature and difficulty nearest the target, then tunes its HP onto it", () => {
    const m = matchBoss(52, ["minotaur", "hydra"]);
    expect(m).toMatchObject({ species: "hydra", difficulty: "medium" });            // 55 is nearest
    expect(m.hp_scale).toBeCloseTo(0.95);
    expect(Math.abs(m.power - 52)).toBeLessThanOrEqual(2);
    // far beyond any creature: the strongest pair, its HP up to 2.5x
    expect(matchBoss(1000, ["minotaur"])).toMatchObject({ species: "minotaur", difficulty: "nightmare", hp_scale: 2.5 });
    expect(() => matchBoss(10, [])).toThrow();
  });

  it("Survival climbs 12% a boss from 70% of your power; Boss Rush is your 3 strongest hunts, weakest first, each stronger", () => {
    expect([0, 1, 5].map((s) => survivalTarget(100, s))).toEqual([70, 82, 130]);
    const plan = rushPlan(100, ["simurgh", "hydra", "naga", "minotaur"]);
    expect(plan.map((p) => p.species)).toEqual(["naga", "hydra", "simurgh"]);
    expect(plan[0].power).toBeLessThan(plan[1].power);
    expect(plan[1].power).toBeLessThan(plan[2].power);
  });
});
