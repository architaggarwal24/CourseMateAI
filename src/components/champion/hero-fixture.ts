// A HeroView for tests (the shape GET /hero sends, game/build.ts heroView).
import type { HeroView } from "@/hooks/useMyHero";

export function heroView(over: Partial<HeroView> = {}): HeroView {
  const node = (id: string, name: string, ranks = 1) => ({ id, branch: id[0] as "o" | "d" | "m", tier: Number(id[1]), name, text: `${name} does a thing.`, ranks });
  return {
    level: 4, xp: 400, level_xp: 40, next_level_xp: 240, skill_points: 3, skill_spent: 0, loadout_budget: 7, loadout_cost: 4,
    look: null, build: { style: "apprentice", passive: "second_wind", ultimate: "rally", perks: [], weaknesses: [] }, tree: {},
    catalog: {
      styles: [
        { id: "apprentice", name: "Apprentice Blade", bonus: "A right Guard also gives +1 Focus.", weakness: { name: "Untrained", text: "Slower ultimate." }, anim: "sword", owned: true, how: "Your starting style", progress: null, for_sale: null },
        { id: "katana", name: "Katana", bonus: "Strike hits x1.1.", weakness: { name: "Glass Edge", text: "A wrong Heavy costs a heart." }, anim: "blade", owned: false, how: "Kaien at 100% mastery", progress: 42, for_sale: null },
        { id: "chain_whip", name: "Chain Whip", bonus: "Jab x0.7 with 5 more seconds.", weakness: { name: "Loose Grip", text: "Strike x0.9." }, anim: "whip", owned: false, how: "Shop", progress: null, for_sale: { coins: 1200, level: 12, can_buy: false } },
      ],
      passives: [
        { id: "second_wind", name: "Second Wind", text: "Heal at 1 heart.", cost: 2, owned: true, how: "Start", progress: null },
        { id: "riposte", name: "Riposte", text: "Hit back.", cost: 4, owned: false, how: "Kaien at 50% mastery", progress: 42 },
      ],
      ultimates: [
        { id: "rally", name: "Rally", text: "+2 hearts.", cost: 2, owned: true, how: "Start", progress: null },
        { id: "overdrive", name: "Overdrive", text: "x1.6 twice.", cost: 4, owned: true, how: "Skill tree", progress: null },
      ],
      perks: [{ id: "lucky_coin", name: "Lucky Coin", text: "+10% coins.", cost: 1, owned: true, how: "Shop", for_sale: null }],
      weaknesses: [{ id: "glass_body", name: "Glass Body", text: "3 fewer hearts.", points: 3 }],
      tree: [node("o1", "Sharpened", 2), node("o2", "Opening"), node("o3", "Combo Fuel"), node("o4", "Heavy Hands", 2), node("o5", "Finisher"), node("o6", "Overdrive"),
        node("d1", "Tough", 2), node("d2", "Parry"), node("d3", "Thick Skin"), node("d4", "Steady"), node("d5", "Last Stand"), node("d6", "Aegis Dome"),
        node("m1", "Recall", 2), node("m2", "Insightful"), node("m3", "Focus Flow"), node("m4", "Deep Focus"), node("m5", "Quick Study"), node("m6", "Clarity")],
    },
    looks_unlocked: [],
    ...over,
  };
}
