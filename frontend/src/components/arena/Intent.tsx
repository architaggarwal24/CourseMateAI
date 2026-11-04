import {
  ChevronsRight, CircleHelp, Crosshair, Droplets, Gem, Hammer, HandGrab, HeartPulse, Mountain, Shield, Sparkles, Star, Sword, Zap,
} from "lucide-react";
import { DAMAGING_INTENTS, type Intent as IntentT, type IntentKind } from "@/lib/arena/types";

const ICON: Record<IntentKind, typeof Sword> = {
  attack: Sword, heavy: Hammer, shield: Shield, drain: Droplets, heal: HeartPulse,
  grab: HandGrab, riddle: CircleHelp, illusion: Sparkles, charge: ChevronsRight, aim: Crosshair, throw: Mountain,
  hoard: Gem, stunned: Star,
};
const HINT: Record<IntentKind, string> = {
  attack: "Guard blocks it. A right answer halves it.",
  heavy: "A big hit coming. Guard blocks it fully.",
  shield: "Absorbs your next damage. Weakness hits ignore it.",
  drain: "A wrong answer loses all your Focus.",
  heal: "Interrupt it with a right Strike or Heavy.",
  grab: "Miss and the move you used is locked. A right answer breaks free.",
  riddle: "A riddle: right hits harder, wrong hurts more. No Insight.",
  illusion: "One option is fake. Believe it and lose Focus.",
  charge: "A right answer can't halve it. A right Guard stuns it.",
  aim: "It takes aim. Next turn it throws: Guard or Jab.",
  throw: "A right answer can't halve it. A right Guard or Jab dodges.",
  hoard: "A hard treasure question: right steals a heart and Focus.",
  stunned: "It does nothing this turn, and your hit lands harder.",
};

/** The boss's telegraphed move: icon, name, how big, and what counters it. Said in words, never colour alone. */
export default function Intent({ intent, compact = false }: { intent: IntentT | null | undefined; compact?: boolean }) {
  if (!intent) return null;
  const Icon = ICON[intent.kind] ?? Zap;
  const amount = DAMAGING_INTENTS.includes(intent.kind) ? `${intent.value} ♥`
    : intent.kind === "shield" ? `${intent.value} HP` : intent.kind === "heal" ? `+${intent.amount ?? intent.value}${intent.amount ? " HP" : "%"}` : "";
  return (
    <div className="arena-intent" data-kind={intent.kind} data-special={intent.special || undefined} data-compact={compact || undefined}
         role="status" aria-label={`Boss intent: ${intent.name}${amount ? `, ${amount}` : ""}. ${intent.description}`}>
      <span className="arena-intent__icon" aria-hidden="true"><Icon size={compact ? 14 : 18} /></span>
      <span className="arena-intent__text">
        <span className="arena-intent__name">{intent.name}{amount && <b className="pixel-font"> {amount}</b>}</span>
        {!compact && <span className="arena-intent__hint">{intent.description || HINT[intent.kind]}</span>}
      </span>
    </div>
  );
}
