import {
  ChevronsRight, CircleHelp, Crosshair, Crown, Droplets, Flame, Gem, Hammer, HandGrab, HeartPulse, Mountain, Shield, Sparkles, Star, Sword, Zap,
} from "@/components/ui/icons";
import { DAMAGING_INTENTS, type Intent as IntentT, type IntentKind } from "@/lib/arena/types";
import { EffectIcon } from "./EffectChips";

const ICON: Record<IntentKind, typeof Sword> = {
  attack: Sword, heavy: Hammer, shield: Shield, drain: Droplets, heal: HeartPulse,
  grab: HandGrab, riddle: CircleHelp, illusion: Sparkles, charge: ChevronsRight, aim: Crosshair, throw: Mountain,
  hoard: Gem, stunned: Star, fury: Flame, finale: Crown,
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
  fury: "Its enraged blow. A right answer halves it; a right Guard blocks it.",
  finale: "It can barely stand: one quick question for your FINAL MOVE.",
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
        <span className="arena-intent__name">{intent.name}{amount && <b className="pixel-font"> {amount}</b>}{intent.hits && intent.hits > 1 ? <span className="arena-intent__hits"> ×{intent.hits}</span> : null}</span>
        {intent.effect && <span className="arena-intent__effect" data-kind={intent.effect.kind}><EffectIcon kind={intent.effect.kind} size={12} />{intent.effect.name}</span>}
        {!compact && <span className="arena-intent__hint">{intent.description || HINT[intent.kind]}</span>}
      </span>
    </div>
  );
}
