import { Droplets, Hammer, HeartPulse, Shield, Sword, Zap } from "lucide-react";
import type { Intent as IntentT, IntentKind } from "@/lib/arena/types";

const ICON: Record<IntentKind, typeof Sword> = { attack: Sword, heavy: Hammer, shield: Shield, drain: Droplets, heal: HeartPulse };
const HINT: Record<IntentKind, string> = {
  attack: "Guard blocks it. A right answer halves it.",
  heavy: "A big hit coming. Guard blocks it fully.",
  shield: "Absorbs your next damage. Weakness hits ignore it.",
  drain: "A wrong answer loses all your Focus.",
  heal: "Interrupt it with a right Strike or Heavy.",
};

/** The boss's telegraphed move: icon, name, how big, and what counters it. Said in words, never colour alone. */
export default function Intent({ intent, compact = false }: { intent: IntentT | null | undefined; compact?: boolean }) {
  if (!intent) return null;
  const Icon = ICON[intent.kind] ?? Zap;
  const amount = intent.kind === "attack" || intent.kind === "heavy" ? `${intent.value} ♥`
    : intent.kind === "shield" ? `${intent.value} HP` : intent.kind === "heal" ? `+${intent.amount ?? intent.value}${intent.amount ? " HP" : "%"}` : "";
  return (
    <div className="arena-intent" data-kind={intent.kind} data-compact={compact || undefined} role="status" aria-label={`Boss intent: ${intent.name}${amount ? `, ${amount}` : ""}. ${intent.description}`}>
      <span className="arena-intent__icon" aria-hidden="true"><Icon size={compact ? 14 : 18} /></span>
      <span className="arena-intent__text">
        <span className="arena-intent__name">{intent.name}{amount && <b className="pixel-font"> {amount}</b>}</span>
        {!compact && <span className="arena-intent__hint">{intent.description || HINT[intent.kind]}</span>}
      </span>
    </div>
  );
}
