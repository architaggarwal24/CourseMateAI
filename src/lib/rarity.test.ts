import { describe, expect, it } from "vitest";
import { RARITIES, RARITY_PRICE_STEPS, isRarity, rarityOf } from "./rarity";

describe("rarity", () => {
  it("follows the price of a shop item", () => {
    expect(rarityOf({ price: 0 })).toBe("common");
    expect(rarityOf({ price: RARITY_PRICE_STEPS.rare - 1 })).toBe("common");
    expect(rarityOf({ price: RARITY_PRICE_STEPS.rare })).toBe("rare");
    expect(rarityOf({ price: RARITY_PRICE_STEPS.epic })).toBe("epic");
    expect(rarityOf({ price: RARITY_PRICE_STEPS.legendary })).toBe("legendary");
    expect(rarityOf({ price: 10000 })).toBe("legendary");
  });

  it("an item that names its rarity keeps it", () => {
    expect(rarityOf({ price: 0, rarity: "epic" })).toBe("epic");
    expect(rarityOf({ price: 9999, rarity: "nonsense" })).toBe("legendary");
  });

  it("copes with missing data", () => {
    expect(rarityOf(null)).toBe("common");
    expect(rarityOf({})).toBe("common");
    expect(rarityOf({ price: null })).toBe("common");
  });

  it("has the four rarities the tokens define", () => {
    expect([...RARITIES]).toEqual(["common", "rare", "epic", "legendary"]);
    expect(isRarity("rare")).toBe(true);
    expect(isRarity("mythic")).toBe(false);
  });
});
