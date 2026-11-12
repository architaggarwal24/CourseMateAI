"use client";

import { useEffect, useState } from "react";
import { onSfx, type Sfx } from "@/lib/sound/chip";

/** What the champion in the Hero panel is doing (the two worlds, Stage 3: the living panel). */
export type HeroMood = "idle" | "cheer" | "flinch" | "sleep";

/** Good news it celebrates; bad news it flinches at (heard through the game's sound effects, sound on or off). */
export const CHEER: Sfx[] = ["win", "levelup", "quest", "achievement", "chest", "buy", "coin"];
export const FLINCH: Sfx[] = ["lose", "hurt"];
export const CHEER_MS = 1800, FLINCH_MS = 900;
/** No mouse, key or touch in the Hero world for this long: it dozes off (zzz) until you're back. */
export const SLEEP_AFTER_MS = 60_000;

export function useHeroMood(): HeroMood {
  const [mood, setMood] = useState<HeroMood>("idle");
  useEffect(() => {
    let back: ReturnType<typeof setTimeout> | null = null;
    let doze: ReturnType<typeof setTimeout> | null = null;
    const set = (m: HeroMood, ms: number) => {
      setMood(m);
      if (back) clearTimeout(back);
      back = setTimeout(() => setMood("idle"), ms);
    };
    const off = onSfx((name) => { if (CHEER.includes(name)) set("cheer", CHEER_MS); else if (FLINCH.includes(name)) set("flinch", FLINCH_MS); });
    const awake = () => {
      setMood((m) => (m === "sleep" ? "idle" : m));
      if (doze) clearTimeout(doze);
      doze = setTimeout(() => setMood((m) => (m === "idle" ? "sleep" : m)), SLEEP_AFTER_MS);
    };
    awake();
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, awake, { passive: true });
    return () => {
      off();
      if (back) clearTimeout(back);
      if (doze) clearTimeout(doze);
      for (const e of events) window.removeEventListener(e, awake);
    };
  }, []);
  return mood;
}
