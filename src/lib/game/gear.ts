// What a piece of gear does in the arena, as short labels. The numbers come from the shop (item.battle, which the
// server also uses in the fight; backend/content/shop.json), so the screens never state a bonus the server ignores.

export interface BattleStats { damage_pct?: number; hp?: number; time_sec?: number; strike?: number }
export interface GearChip { key: "damage" | "hp" | "time" | "strike"; label: string; value: string; hint: string }

/** One chip per effect an item (or a whole loadout) has; empty when it has none. */
export function gearChips(stats: BattleStats | null | undefined): GearChip[] {
  const s = stats ?? {};
  const out: GearChip[] = [];
  if (s.damage_pct) out.push({ key: "damage", label: "Damage", value: `+${Math.round(s.damage_pct * 100)}%`, hint: "Extra damage on every hit" });
  if (s.hp) out.push({ key: "hp", label: "Hearts", value: `+${s.hp}`, hint: "Extra hearts at the start of a battle" });
  if (s.time_sec) out.push({ key: "time", label: "Time", value: `+${s.time_sec}s`, hint: "More seconds on every question" });
  if (s.strike) out.push({ key: "strike", label: "Strike", value: `+${s.strike}`, hint: "Your pet strikes for this much once your combo reaches 3" });
  return out;
}

/** Add up the `battle` stats of the worn items (the same sum the server takes when a battle starts). */
export function totalGear(items: Array<{ battle?: BattleStats } | undefined | null>): Required<BattleStats> {
  const t = { damage_pct: 0, hp: 0, time_sec: 0, strike: 0 };
  for (const it of items) {
    const b = it?.battle;
    if (!b) continue;
    t.damage_pct += b.damage_pct ?? 0;
    t.hp += b.hp ?? 0;
    t.time_sec += b.time_sec ?? 0;
    t.strike += b.strike ?? 0;
  }
  t.damage_pct = Math.round(t.damage_pct * 10000) / 10000;
  return t;
}
