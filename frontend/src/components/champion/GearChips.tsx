import { gearChips, type BattleStats } from "@/lib/gear";
import { cn } from "@/lib/utils";
import "./gear.css";

/** The arena effects of an item or a loadout, as small chips ("Damage +12%"). Says nothing when there are none. */
export default function GearChips({ stats, className }: { stats: BattleStats | null | undefined; className?: string }) {
  const chips = gearChips(stats);
  if (chips.length === 0) return null;
  return (
    <ul className={cn("gear-chips", className)} aria-label="Arena effects">
      {chips.map((c) => (
        <li key={c.key} className="gear-chip" data-kind={c.key} title={c.hint}>
          <span className="gear-chip__label">{c.label}</span>
          <strong className="gear-chip__value">{c.value}</strong>
        </li>
      ))}
    </ul>
  );
}
