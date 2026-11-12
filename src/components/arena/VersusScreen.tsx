"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { shortcutBlocked } from "@/lib/keys";
import { DIFFICULTY_LABEL, type Battle } from "@/lib/arena/types";
import PixelSprite from "./pixel/PixelSprite";
import LoreTip from "@/components/fx/LoreTip";
import { useFighter, useFighterPet } from "./pixel/useFighter";

/** How long the VS screen holds once the questions are ready (Enter skips it). */
export const VS_HOLD_MS = 2400;

/**
 * The VS screen (Stage 5): your champion on the left, the boss on the right, VS between them, while the last of the
 * fight's questions are written. When they are ready it holds a moment (Enter skips) and the fight opens: no round
 * call, no boss card (the boss's card lives in the Bestiary).
 */
export default function VersusScreen({ battle, ready, failed, onBegin, onRetry }: {
  battle: Battle; ready: boolean; failed: boolean; onBegin: () => void; onRetry: () => void;
}) {
  const fighter = useFighter();
  const pet = useFighterPet();
  const [held, setHeld] = useState(false);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const hold = setTimeout(() => setHeld(true), VS_HOLD_MS);
    const tick = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => { clearTimeout(hold); clearInterval(tick); };
  }, []);
  const began = useRef(false);
  const begin = () => { if (began.current || !ready) return; began.current = true; onBegin(); };
  useEffect(() => { if (ready && held) begin(); }, [ready, held]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = useRef(begin);
  live.current = begin;
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shortcutBlocked(e) || (e.key !== "Enter" && e.key !== " ")) return;
      if ((e.target as HTMLElement | null)?.closest?.("button")) return;
      e.preventDefault();
      live.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tag = battle.mode === "nemesis" ? "Nemesis" : `Tier ${["", "I", "II", "III", "IV"][battle.tier ?? 1] ?? battle.tier} · ${DIFFICULTY_LABEL[battle.difficulty as keyof typeof DIFFICULTY_LABEL] ?? battle.difficulty}`;
  return (
    <section className="arena-vs" aria-labelledby="arena-vs-title" data-ready={ready || undefined}>
      <h2 id="arena-vs-title" className="sr-only">{`${fighter.name} versus ${battle.boss.name}`}</h2>
      <div className="arena-vs__side arena-vs__side--hero" style={{ "--hero-accent": fighter.accent } as React.CSSProperties}>
        <PixelSprite hero={fighter} pet={pet} anim="win" className="arena-vs__sprite" />
        <span className="arena-vs__name pixel-font">{fighter.name}</span>
      </div>
      <span className="arena-vs__vs pixel-font" aria-hidden="true">VS</span>
      <div className="arena-vs__side arena-vs__side--boss">
        {battle.boss.species && <PixelSprite boss={battle.boss.species} anim="idle" fidget flip className="arena-vs__sprite" />}
        <span className="arena-vs__name pixel-font">{battle.boss.name}</span>
        {battle.boss.title && <span className="arena-vs__title">{battle.boss.title}</span>}
        <span className="arena-vs__tag pixel-font">{tag}</span>
      </div>
      <div className="arena-vs__foot">
        <p className="arena-vs__status" role="status" aria-live="polite">
          {failed ? "The questions didn't come. Nothing is lost."
            : ready ? "Ready. Press Enter to fight."
            : <>Writing the fight&apos;s questions…{secs >= 3 && <span className="pixel-font" aria-hidden="true"> {secs}s</span>}</>}
        </p>
        {failed && <Button variant="primary" onClick={onRetry}>Try again</Button>}
        {ready && !failed && <Button variant="primary" onClick={begin} aria-keyshortcuts="Enter">Fight!</Button>}
        {!ready && !failed && <LoreTip />}
      </div>
    </section>
  );
}
