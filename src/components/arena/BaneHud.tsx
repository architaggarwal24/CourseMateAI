"use client";

import type { BaneHud as Bane, Move } from "@/lib/arena/types";

const LABEL: Record<Move, string> = { strike: "Strike", jab: "Jab", heavy: "Heavy", guard: "Guard" };

/**
 * The creature's bane above the move buttons: its clue until the bane is written in (after the first win), then
 * the combo with the moves already landed lit. Answering right with those moves in a row staggers the creature.
 */
export default function BaneHud({ bane }: { bane?: Bane | null }) {
  if (!bane) return null;
  if (!bane.known || !bane.moves) {
    return <p className="arena-bane arena-bane--clue"><span className="arena-bane__label">Bane</span> “{bane.clue}”</p>;
  }
  return (
    <p className="arena-bane" aria-label={`Bane: ${bane.moves.map((m) => LABEL[m]).join(", then ")}. ${bane.progress} of ${bane.moves.length} landed.`}>
      <span className="arena-bane__label" aria-hidden="true">Bane</span>
      {bane.moves.map((m, i) => (
        <span key={i} className="arena-bane__step" data-done={i < bane.progress || undefined} aria-hidden="true">{LABEL[m]}</span>
      ))}
    </p>
  );
}
