// One definition of "how rare is this?" for the Hero area. Shop, inventory, avatar and achievements all colour
// by the same four rarities, through the tokens --color-rarity-* (src/styles/tokens.css) - never a hard-coded colour.
//
// Shop items carry no rarity field, so it follows from what they cost; achievements bring their own `tier`.

export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABEL: Record<Rarity, string> = {
  common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary",
};

/** Coin price at which an item becomes rare / epic / legendary. */
export const RARITY_PRICE_STEPS = { rare: 300, epic: 1000, legendary: 3000 } as const;

export function isRarity(value: unknown): value is Rarity {
  return typeof value === "string" && (RARITIES as readonly string[]).includes(value);
}

/** The rarity of a shop item (by price) or of anything that names its own (achievement `tier`). */
export function rarityOf(item: Record<string, any> | null | undefined): Rarity {
  if (!item) return "common";
  if (isRarity(item.rarity)) return item.rarity;
  const price = Number(item.price ?? 0);
  if (price >= RARITY_PRICE_STEPS.legendary) return "legendary";
  if (price >= RARITY_PRICE_STEPS.epic) return "epic";
  if (price >= RARITY_PRICE_STEPS.rare) return "rare";
  return "common";
}

/** A CSS class from hero.css: `.rarity--<name>` sets --rarity to the token, so borders/labels can use var(--rarity). */
export const rarityClass = (r: Rarity) => `rarity rarity--${r}`;
