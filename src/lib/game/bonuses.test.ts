import { describe, expect, it } from "vitest";
import { studyBonuses } from "./bonuses";

const crown = { id: "head_glacial", name: "Glacial Crown", bonus: { xp_pct: 0.1, coin_pct: 0.08 } };
const cowl = { id: "head_cowl", name: "Archmage's Cowl", bonus: { xp_pct: 0.08 } };
const legend = { id: "title_legend", name: "Living Legend", bonus: { xp_pct: 0.3, coin_pct: 0.2, arena_hints: 2 } };
const helm = { id: "head_link", name: "Neural Link Helm", bonus: { arena_hints: 1 } };
const plain = { id: "armor_tee", name: "Plain Tee", bonus: {} };

describe("study bonuses: only the best item for each stat counts", () => {
  it("takes the strongest value per stat, not the sum", () => {
    const b = studyBonuses([crown, cowl, legend, helm, plain]);
    expect(b.totals).toEqual({ xp_pct: 0.3, coin_pct: 0.2, combo_xp_pct: 0, arena_hints: 2 });
    expect(b.best).toEqual({ xp_pct: "title_legend", coin_pct: "title_legend", arena_hints: "title_legend" });
  });

  it("lists each stat once, with the item it comes from and the weaker ones that don't count", () => {
    const b = studyBonuses([crown, cowl, legend]);
    expect(b.stats.map((s) => [s.key, s.label, s.value, s.from])).toEqual([
      ["xp_pct", "XP", "+30%", "Living Legend"],
      ["coin_pct", "Coins", "+20%", "Living Legend"],
      ["arena_hints", "Hints", "+2", "Living Legend"],
    ]);
    expect(b.stats[0].others).toEqual([{ name: "Glacial Crown", value: "+10%" }, { name: "Archmage's Cowl", value: "+8%" }]);
  });

  it("a tie keeps the first item; nothing worn means no stats", () => {
    expect(studyBonuses([cowl, { ...cowl, id: "x", name: "Copy" }]).best.xp_pct).toBe("head_cowl");
    expect(studyBonuses([]).stats).toEqual([]);
    expect(studyBonuses([plain]).totals.xp_pct).toBe(0);
  });

  it("streak freeze keeps the shortest wait, as before", () => {
    const b = studyBonuses([{ id: "a", name: "A", bonus: { streak_freeze_days: 7 } }, { id: "b", name: "B", bonus: { streak_freeze_days: 3 } }]);
    expect(b.totals.streak_freeze_days).toBe(3);
  });
});
