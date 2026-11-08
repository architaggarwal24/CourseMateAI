"use client";

import { useEffect, useState } from "react";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { HEROES } from "@/lib/pixel/heroes";
import type { AnimName } from "@/lib/pixel/heroes";
import type { BossAnim } from "@/lib/pixel/bosses";

/** A loop of one exchange: the champion strikes, the creature reels, then they reset. Still under reduced motion. */
const BEATS: { hero: AnimName; boss: BossAnim; ms: number }[] = [
  { hero: "idle", boss: "idle", ms: 1400 },
  { hero: "attack", boss: "hit", ms: 700 },
  { hero: "idle", boss: "attack", ms: 700 },
  { hero: "guard", boss: "idle", ms: 600 },
  { hero: "cast", boss: "hit", ms: 900 },
  { hero: "win", boss: "idle", ms: 1200 },
];

/**
 * The landing page's game band: a champion and a creature from the Bestiary trading blows in the pixel style of
 * the Hero area. A new champion each loop. Decorative (the text beside it says what it is).
 */
export default function LandingDuel() {
  const [i, setI] = useState(0);
  const [hero, setHero] = useState(0);
  const [still, setStill] = useState(false);
  useEffect(() => {
    const quiet = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.documentElement.classList.contains("reduce-animations");
    setStill(!!quiet);
    if (quiet) return;
    const t = setTimeout(() => {
      setI((n) => (n + 1) % BEATS.length);
      if (i === BEATS.length - 1) setHero((h) => (h + 1) % HEROES.length);
    }, BEATS[i].ms);
    return () => clearTimeout(t);
  }, [i]);
  const beat = still ? BEATS[0] : BEATS[i];
  return (
    <div className="landing-duel" aria-hidden="true">
      <div className="landing-duel__fighter"><PixelSprite hero={HEROES[hero]} anim={beat.hero} className="landing-duel__sprite" /></div>
      <div className="landing-duel__fighter landing-duel__fighter--boss"><PixelSprite boss="minotaur" anim={beat.boss} flip className="landing-duel__sprite" /></div>
      <div className="landing-duel__ground" />
    </div>
  );
}
