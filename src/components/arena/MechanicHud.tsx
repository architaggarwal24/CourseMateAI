import { Lock } from "lucide-react";
import type { MechanicHud as Mech } from "@/lib/arena/types";

/**
 * The creature's signature mechanic in the HUD: its name, its rule in one line (full mode) and its counters
 * (heads, fury, coils...). Counters are said in words and numbers, never by colour alone.
 */
export default function MechanicHud({ mechanic, compact = false }: { mechanic: Mech | null | undefined; compact?: boolean }) {
  if (!mechanic) return null;
  return (
    <div className="arena-mech" data-mechanic={mechanic.id} data-compact={compact || undefined} aria-label={`Creature mechanic: ${mechanic.name}`} role="group">
      <span className="arena-mech__name pixel-font">{mechanic.name}</span>
      {!compact && <span className="arena-mech__rule">{mechanic.summary}</span>}
      {(mechanic.counters.length > 0 || mechanic.locked_moves.length > 0) && (
        <ul className="arena-mech__counters" aria-label={`${mechanic.name} counters`}>
          {mechanic.counters.map((c) => (
            <li key={c.label} className="arena-mech__counter" title={c.hint}>
              <span className="arena-stat__label">{c.label}</span>
              {c.text !== undefined
                ? <b className="arena-mech__text">{c.text}</b>
                : <b className="pixel-font">{c.value}{c.max ? `/${c.max}` : ""}</b>}
              {c.hint && <span className="sr-only">: {c.hint}</span>}
            </li>
          ))}
          {mechanic.locked_moves.map((m) => (
            <li key={`lock-${m}`} className="arena-mech__counter" data-locked="true">
              <Lock size={12} aria-hidden="true" /><span>{m[0].toUpperCase() + m.slice(1)} locked</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
