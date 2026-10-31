"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Feather, Hammer, ShieldHalf, Sword } from "lucide-react";
import { MOVES, MOVE_INFO, type Battle, type Move } from "@/lib/arena/types";
import { shortcutBlocked } from "@/lib/keys";
import Intent from "./Intent";

const ICON: Record<Move, typeof Sword> = { strike: Sword, jab: Feather, heavy: Hammer, guard: ShieldHalf };

/**
 * The turn's choice: what the boss is about to do, then four moves. Each move asks a question of a different
 * difficulty and does something different with a right answer. Keys Q W E R pick them.
 */
export default function MovePicker({ battle, onPick, disabled }: { battle: Battle; onPick: (m: Move) => void; disabled?: boolean }) {
  const focus = battle.focus ?? 0;
  const heavyCost = battle.heavy_cost ?? 2;
  const can = (m: Move) => m !== "heavy" || focus >= heavyCost;

  // A new turn: focus moves to "Your move" (the panel that held focus before is gone), without scrolling the page.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  // Q W E R pick a move. One listener reading the latest props through a ref (no gap between re-renders).
  const live = useRef({ disabled, onPick, can });
  live.current = { disabled, onPick, can };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = live.current;
      if (l.disabled || shortcutBlocked(e)) return;
      const m = MOVES.find((x) => MOVE_INFO[x].key.toLowerCase() === e.key.toLowerCase());
      if (m && l.can(m)) { e.preventDefault(); l.onPick(m); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section className="arena-moves" aria-labelledby="arena-moves-title">
      <div className="arena-moves__head">
        <h3 id="arena-moves-title" ref={heading} tabIndex={-1} className="arena-moves__title">Your move</h3>
        <Intent intent={battle.intent} />
      </div>
      <ul className="arena-moves__list">
        {MOVES.map((m, i) => {
          const Icon = ICON[m];
          const info = MOVE_INFO[m];
          const ok = can(m);
          return (
            <motion.li key={m} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                       transition={{ delay: i * 0.05, type: "spring", stiffness: 380, damping: 28 }}>
              <button type="button" className="arena-move fx-sheen" data-move={m} disabled={disabled || !ok}
                      aria-keyshortcuts={info.key} onClick={() => onPick(m)}
                      aria-describedby={`arena-move-${m}`}>
                <span className="arena-move__icon" aria-hidden="true"><Icon size={20} /></span>
                <span className="arena-move__name">{info.label}</span>
                <span className="arena-move__tier">{info.tier}</span>
                <span id={`arena-move-${m}`} className="arena-move__blurb">
                  {m === "heavy" ? `180% damage. Costs ${heavyCost} Focus.` : info.blurb}
                  {m === "heavy" && !ok && <> (you have {focus})</>}
                </span>
                <kbd className="kbd arena-move__key" aria-hidden="true">{info.key}</kbd>
              </button>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}
