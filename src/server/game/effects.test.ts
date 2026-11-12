// Stage 3: what a boss's blows do to the champion besides hearts, and its enraged signature blow.
import { describe, expect, it } from "vitest";
import * as fx from "./effects";
import { CREATURES } from "./bestiary";

const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe("effects", () => {
  it("every creature has its own two or three effects and an enraged signature blow; none of them is in the shared pool", () => {
    const shared = new Set(fx.POOL.map((e) => e.id));
    for (const species of Object.keys(CREATURES)) {
      const own = fx.UNIQUE[species];
      expect(own?.length, species).toBeGreaterThanOrEqual(2);
      expect(own.length, species).toBeLessThanOrEqual(3);
      for (const e of own) expect(shared.has(e.id), e.id).toBe(false);
      expect(fx.FURY[species], species).toBeTruthy();
    }
    expect(fx.FURY.hydra).toMatchObject({ name: "All Heads Strike", hits: 5 });
  });

  it("a boss draws two or three shared effects, never two of a kind; its own come from its creature", () => {
    for (let i = 0; i < 50; i++) {
      const pool = fx.drawPool();
      expect(pool.length === 2 || pool.length === 3).toBe(true);
      const kinds = pool.map((id) => fx.effectById(id)!.kind);
      expect(new Set(kinds).size).toBe(kinds.length);
    }
    const boss: Record<string, any> = { species: "kraken" };
    fx.initEffects(boss);
    expect(boss.effects.unique).toEqual(["kraken_ink", "kraken_grip", "kraken_undertow"]);
    expect(boss.player_effects).toEqual([]);
  });

  it("normal form carries a shared effect now and then; enraged, its own more often; never on a blow that doesn't hurt", () => {
    const boss: Record<string, any> = { species: "hydra", effects: { pool: ["burn", "freeze"], unique: ["hydra_venom", "hydra_heads", "hydra_bile"] } };
    expect(fx.chooseEffect(boss, true, seq(0.1, 0))?.id).toBe("burn");
    expect(fx.chooseEffect(boss, true, seq(0.5))).toBeNull();                       // 35% in normal form
    expect(fx.chooseEffect(boss, false, seq(0))).toBeNull();
    boss.rage = true;
    expect(fx.chooseEffect(boss, true, seq(0.5, 0))?.id).toBe("hydra_venom");      // 60% enraged, its own
    const intent = fx.attach({ kind: "attack", name: "Bite", value: 2, description: "Attacks for 2." }, fx.effectById("burn")!);
    expect(intent).toMatchObject({ effect: { id: "burn", name: "Burn" } });
    expect(intent.description).toContain("On a miss: Burn");
  });

  it("enraged, every third turn is the creature's signature blow, carrying one of its own effects", () => {
    const boss: Record<string, any> = { species: "hydra", effects: { unique: ["hydra_venom"] } };
    expect(fx.furyIntent(boss, 3, 3)).toBeNull();                                   // not enraged
    boss.rage = true;
    expect(fx.furyIntent(boss, 3, 4)).toBeNull();
    expect(fx.furyIntent(boss, 3, 6)).toMatchObject({ kind: "fury", name: "All Heads Strike", value: 6, hits: 5, effect: { id: "hydra_venom" } });
  });

  it("landed effects tick after each question and run out; a second of the same kind refreshes it", () => {
    const boss: Record<string, any> = { species: "hydra", player_effects: [] };
    fx.land(boss, fx.effectById("burn")!);
    fx.land(boss, fx.effectById("hydra_venom")!);
    expect(fx.hud(boss).map((e) => [e.id, e.turns, !!e.boss])).toEqual([["burn", 2, false], ["hydra_venom", 4, true]]);
    expect(fx.tick(boss)).toMatchObject({ damage: 2, expired: [] });
    expect(fx.tick(boss)).toMatchObject({ damage: 2, expired: ["Burn"] });
    fx.land(boss, fx.effectById("hydra_venom")!);
    expect(fx.hud(boss)).toEqual([expect.objectContaining({ id: "hydra_venom", turns: 4 })]);
  });

  it("each kind does its thing: clock, locks, silence, curse, weaken, the question screen, sap", () => {
    const boss: Record<string, any> = { species: "kraken", player_effects: [], kit: { meter: 80, max: 100 } };
    expect(fx.clockFactor(boss)).toBe(1);
    boss.rage = true;
    expect(fx.clockFactor(boss)).toBe(fx.RAGE_CLOCK);
    boss.rage = false;
    for (const id of ["freeze", "slow", "kraken_grip", "silence", "curse", "weaken", "kraken_ink", "fog", "confuse"]) fx.land(boss, fx.effectById(id)!);
    expect(fx.clockFactor(boss)).toBe(0.5);                                          // the strongest clock wins
    expect(fx.lockedMoves(boss).sort()).toEqual(["heavy", "strike"]);
    expect(fx.silenced(boss) && fx.cursed(boss)).toBe(true);
    expect(fx.weakenMult(boss)).toBe(0.75);
    expect(fx.questionFx(boss)).toEqual({ blind: 4, fog: 3, shuffle: 1 });
    expect(fx.land(boss, fx.effectById("sap")!).sapped).toBe(20);
    expect(boss.kit.meter).toBe(60);
    const stun: Record<string, any> = { player_effects: [] };
    fx.land(stun, fx.effectById("stun")!, seq(0));
    expect(fx.lockedMoves(stun)).toEqual(["strike"]);                                 // a random move (never Guard)
  });
});
