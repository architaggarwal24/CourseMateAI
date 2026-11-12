"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Coins, FlaskConical, Flag } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import { shortcutBlocked } from "@/lib/keys";
import type { Battle } from "@/lib/arena/types";

/** How long after the countdown the server settles the fight (its grace), so the client asks just after. */
const SETTLE_AFTER_MS = 5500;

/**
 * Knocked down (Stage 4): CONTINUE? with a countdown. A health potion from the bag brings you back free; coins cost
 * more each time; up to 3 a fight (the boss keeps its HP). Keys: P potion, C coins, Esc give up. When the count
 * reaches 0 the fight is lost (the server settles it; this asks for the result a moment later).
 */
export default function ContinueScreen({ battle, potions, onContinue, onGiveUp, onTimeout }: {
  battle: Battle; potions: number; onContinue: (by: "potion" | "coins") => Promise<boolean>; onGiveUp: () => void; onTimeout: () => void;
}) {
  const down = battle.down!;
  const deadline = Date.parse(down.deadline);
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  const [busy, setBusy] = useState<"potion" | "coins" | null>(null);
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 200);
    const settle = setTimeout(onTimeout, Math.max(0, deadline - Date.now()) + SETTLE_AFTER_MS);
    return () => { clearInterval(t); clearTimeout(settle); };
  }, [deadline]); // eslint-disable-line react-hooks/exhaustive-deps

  const can = down.can_continue && left > 0 && busy === null;
  const go = async (by: "potion" | "coins") => { setBusy(by); await onContinue(by); setBusy(null); };
  const live = useRef({ can, potions, go, onGiveUp });
  live.current = { can, potions, go, onGiveUp };
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const l = live.current;
      if (shortcutBlocked(e)) return;
      const k = e.key.toLowerCase();
      if (k === "p" && l.can && l.potions > 0) { e.preventDefault(); void l.go("potion"); }
      else if (k === "c" && l.can) { e.preventDefault(); void l.go("coins"); }
      else if (e.key === "Escape") { e.preventDefault(); l.onGiveUp(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  return (
    <section className="arena-continue" aria-labelledby="arena-continue-title" data-urgent={left <= 3 || undefined}>
      <h3 id="arena-continue-title" ref={heading} tabIndex={-1} className="arena-continue__title pixel-font">Continue?</h3>
      <p className="arena-continue__count pixel-font" role="timer" aria-label={`${left} seconds to continue`}>{left}</p>
      <p className="m-0 text-sm text-fg-2">
        {down.can_continue
          ? <>You&apos;re down. Get back up with full hearts: {battle.boss.name} keeps its wounds. Continue {down.continues + 1} of {down.max}.</>
          : <>No continues left in this fight.</>}
      </p>
      <div className="arena-continue__actions">
        <Button variant="reward" disabled={!can || potions <= 0} loading={busy === "potion"} aria-keyshortcuts="P" onClick={() => void go("potion")}>
          <FlaskConical size={16} aria-hidden="true" />Use a potion <span className="arena-item-count pixel-font">x{potions}</span>
        </Button>
        <Button variant="primary" disabled={!can} loading={busy === "coins"} aria-keyshortcuts="C" onClick={() => void go("coins")}>
          <Coins size={16} aria-hidden="true" />Pay {down.coins} coins
        </Button>
        <Button variant="ghost" onClick={onGiveUp} aria-keyshortcuts="Escape"><Flag size={16} aria-hidden="true" />Give up</Button>
      </div>
    </section>
  );
}
