"use client";

import { useEffect, useState } from "react";
import { Feather } from "@/components/ui/icons";

/** What a Hero loading screen tells you while you wait: tips for the fight and lore from the Bestiary. */
export const LORE_TIPS: string[] = [
  "Tip: a right Guard against a charging Minotaur stuns it.",
  "Tip: at x5 combo, every third right answer is a combo special.",
  "Tip: bring a boss under 15% and you get one quick question for your final move.",
  "Tip: knocked down? A health potion brings you back for free.",
  "Tip: read the boss's intent before you pick your move.",
  "Tip: Esc pauses a fight. Its clock stops while you're away.",
  "Tip: Boss Rush opens once you've hunted three different creatures.",
  "Lore: the Hydra grows two heads for every one it loses.",
  "Lore: the Sphinx asks riddles. It answers to no one.",
  "Lore: Fenrir is bound by a ribbon finer than silk and stronger than iron.",
  "Lore: the Kitsune grows a new tail every hundred years.",
  "Lore: Ammit waits by the scales, hungry for the hearts that fail.",
  "Lore: the Simurgh has seen the world destroyed three times.",
  "The Scribe says: every page of the Bestiary was written in someone's ink.",
];

/**
 * A line of lore or a tip, changing every few seconds (Hero loading screens: the two worlds, Stage 3). It starts
 * at a random line so each wait reads differently; it is quiet for screen readers (it is flavour, not news).
 */
export default function LoreTip({ every = 5000 }: { every?: number }) {
  const [i, setI] = useState<number | null>(null);
  useEffect(() => {
    setI(Math.floor(Math.random() * LORE_TIPS.length));
    const t = setInterval(() => setI((k) => ((k ?? 0) + 1) % LORE_TIPS.length), every);
    return () => clearInterval(t);
  }, [every]);
  if (i === null) return null;
  return (
    <p className="lore-tip" aria-hidden="true" data-testid="lore-tip">
      <Feather size={14} aria-hidden="true" /><span key={i} className="lore-tip__text">{LORE_TIPS[i]}</span>
    </p>
  );
}
