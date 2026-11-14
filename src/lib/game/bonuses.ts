// Study bonuses from what the hero wears (shared by the server, which applies them, and the Hero pages, which show
// them). Only the best item for each stat counts: a +30% XP title and a +10% XP crown give +30% XP, not +40%. That
// keeps bonuses meaningful (stacking five items used to reach +97% XP) and makes "which item gives what" easy to read.

export interface BonusValues { xp_pct?: number; coin_pct?: number; combo_xp_pct?: number; arena_hints?: number; streak_freeze_days?: number }
export interface BonusItem { id: string; name?: string; bonus?: BonusValues | null }

type StatKey = "xp_pct" | "coin_pct" | "combo_xp_pct" | "arena_hints";
const STATS: { key: StatKey; label: string; fmt: (v: number) => string }[] = [
  { key: "xp_pct", label: "XP", fmt: (v) => `+${Math.round(v * 100)}%` },
  { key: "coin_pct", label: "Coins", fmt: (v) => `+${Math.round(v * 100)}%` },
  { key: "combo_xp_pct", label: "Combo XP", fmt: (v) => `+${Math.round(v * 100)}%` },
  { key: "arena_hints", label: "Hints", fmt: (v) => `+${v}` },
];

export interface BonusStat { key: StatKey; label: string; value: string; amount: number; from: string; others: { name: string; value: string }[] }

export function studyBonuses(items: BonusItem[]) {
  const totals: { xp_pct: number; coin_pct: number; combo_xp_pct: number; arena_hints: number; streak_freeze_days?: number } =
    { xp_pct: 0, coin_pct: 0, combo_xp_pct: 0, arena_hints: 0 };
  const best: Partial<Record<StatKey, string>> = {};
  const stats: BonusStat[] = [];
  for (const s of STATS) {
    const having = items.filter((i) => (i.bonus?.[s.key] ?? 0) > 0);
    if (!having.length) continue;
    const top = having.reduce((a, b) => ((b.bonus![s.key] ?? 0) > (a.bonus![s.key] ?? 0) ? b : a));
    const amount = top.bonus![s.key]!;
    totals[s.key] = amount;
    best[s.key] = top.id;
    stats.push({ key: s.key, label: s.label, value: s.fmt(amount), amount, from: top.name ?? top.id,
      others: having.filter((i) => i !== top).map((i) => ({ name: i.name ?? i.id, value: s.fmt(i.bonus![s.key]!) })) });
  }
  const freezes = items.map((i) => i.bonus?.streak_freeze_days).filter((d): d is number => d !== undefined);
  if (freezes.length) totals.streak_freeze_days = Math.min(...freezes);
  return { totals, best, stats };
}
