import type { Outcome } from "@/lib/arena/types";

/**
 * The verdict's lines for what the creature's mechanic and the champion's kit did on this answer, in the order it
 * happened. The server writes each event's sentence (backend core_brains/mechanics.py and kits.py); this only adds
 * the lines no event carries (Riposte's damage, a dodge with no event of its own).
 */
export function mechanicLines(o: Outcome): string[] {
  const lines: string[] = [];
  if ((o.riposte ?? 0) > 0) lines.push(`Riposte! You hit back for ${o.riposte}.`);
  const kit = o.kit?.events ?? [];
  const mech = o.mechanic?.events ?? [];
  const dodgeSaid = [...kit, ...mech].some((e) => ["dodged", "shadowstep", "vanish"].includes(e.type));
  if (o.dodged && !dodgeSaid) lines.push("You dodged the blow.");
  for (const e of mech) lines.push(e.text);
  if ((o.mechanic?.hearts ?? 0) > 0) lines.push(`+${o.mechanic!.hearts} heart.`);
  for (const e of kit) lines.push(e.text);
  return lines;
}
