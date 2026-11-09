import { describe, expect, it } from "vitest";
import { ago, fightNotes, huntTotals, markSeen, nextQuarry, pendingRituals, tierMap } from "./desk";
import type { BestiaryEntry, BestiaryResponse } from "@/lib/arena/types";

const NOW = new Date("2026-11-09T12:00:00Z");
const rec = (o: Partial<NonNullable<BestiaryEntry["record"]>> = {}) => ({ fights: 0, wins: 0, losses: 0, flawless_wins: 0, nightmare_wins: 0,
  best_seconds: null, best_accuracy: null, first_win_at: null, last_fought_at: null, ...o });
const c = (species: string, tier: number, o: Partial<BestiaryEntry> = {}): BestiaryEntry => ({ species, tier, open: tier === 1, met: false, defeated: false,
  name: tier === 1 ? species.toUpperCase() : null, origin: null, teaser_topic: null, mastery: "none", record: null, bane: null, ...o });
const DATA: BestiaryResponse = {
  tiers: [{ tier: 1, name: "Beasts", open: true, beaten: 1, total: 2, opens_next_at: 2 }, { tier: 2, name: "Tricksters", open: false, beaten: 0, total: 1, opens_next_at: 2 }],
  creatures: [
    c("minotaur", 1, { defeated: true, mastery: "silver", lost_page: true, bane: { clue: "", moves: ["guard"], found_alone: false, uses: 1 },
      record: rec({ fights: 6, wins: 5, losses: 1, best_seconds: 70, best_accuracy: 88, last_fought_at: "2026-11-06T10:00:00Z" }) }),
    c("oni", 1, { record: rec({ fights: 2, losses: 2, best_accuracy: 95, last_fought_at: "2026-11-08T10:00:00Z" }) }),
    c("naga", 2),
  ],
};

describe("the desk's numbers", () => {
  it("says how long ago, in words", () => {
    expect(ago("2026-11-09T08:00:00Z", NOW)).toBe("today");
    expect(ago("2026-11-08T08:00:00Z", NOW)).toBe("yesterday");
    expect(ago("2026-11-02T08:00:00Z", NOW)).toBe("7 days ago");
    expect(ago("2026-10-01T08:00:00Z", NOW)).toBe("5 weeks ago");
    expect(ago(null, NOW)).toBeNull();
  });

  it("fight notes follow the record and say what the next seal asks", () => {
    expect(fightNotes(DATA.creatures[0], NOW)).toEqual(["Beaten 5 of 6 fights (83%).", "Last met 3 days ago.", "A flawless win on hard, or any nightmare win, earns the gold seal."]);
    expect(fightNotes(DATA.creatures[1], NOW)).toEqual(["Faced 2 times; it still stands.", "Last met yesterday.", "A first victory earns the bronze seal."]);
    expect(fightNotes(c("cyclops", 1), NOW)).toEqual(["Not yet faced. Its page fills in as you fight it."]);
    expect(fightNotes(DATA.creatures[2], NOW)).toEqual([]);                        // sealed: nothing to say
  });

  it("the hunt record adds up every page", () => {
    const t = huntTotals(DATA, NOW);
    expect(t).toMatchObject({ hunts: 8, victories: 5, losses: 3, written: 1, total: 3, banes: 1, lostPages: 1, seals: { gold: 0, silver: 1, bronze: 0 } });
    expect(t.fastest).toEqual({ name: "MINOTAUR", seconds: 70 });
    expect(t.sharpest).toEqual({ name: "ONI", accuracy: 95 });
    expect(t.last).toEqual({ name: "ONI", species: "oni", when: "yesterday" });
    expect(nextQuarry(DATA)?.species).toBe("oni");
  });

  it("the tier map marks where you are and what breaks the next seal", () => {
    const m = tierMap(DATA);
    expect(m[0]).toMatchObject({ roman: "I", open: true, here: true, hint: null });
    expect(m[1]).toMatchObject({ roman: "II", name: "Sealed", open: false, here: false, hint: "Beat 1 more creature of tier I to break this seal." });
  });

  it("rituals: nothing on a first visit; afterwards each new page and unsealed tier, once", () => {
    expect(pendingRituals(DATA, null)).toEqual({ burn: [], seals: [] });
    const later = { ...DATA, tiers: DATA.tiers.map((t) => ({ ...t, open: true })) };
    const r = pendingRituals(later, { written: [], tiers: [1] });
    expect(r).toEqual({ burn: ["minotaur"], seals: [2] });
    const seen = markSeen(markSeen({ written: [], tiers: [1] }, { species: "minotaur" }), { tier: 2 });
    expect(pendingRituals(later, seen)).toEqual({ burn: [], seals: [] });
  });
});
