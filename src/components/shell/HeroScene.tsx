"use client";

import { useEffect, useState } from "react";
import { useHUDStore } from "@/hooks/useHUD";

/** The time of day by your clock: dawn 5-8, day 8-17, dusk 17-20, night after. */
export type DayTime = "dawn" | "day" | "dusk" | "night";
export const dayTime = (hour: number): DayTime => (hour >= 5 && hour < 8 ? "dawn" : hour >= 8 && hour < 17 ? "day" : hour >= 17 && hour < 20 ? "dusk" : "night");

/** The weather is your streak: clear when you studied today, clouds when today isn't done yet, rain when it broke. */
export type Weather = "clear" | "cloudy" | "rain";
export function weatherOf(streakDays: number, lastActiveUtc: string | null | undefined, now = new Date()): Weather {
  if (streakDays <= 0) return "rain";
  if (!lastActiveUtc) return "cloudy";
  const last = new Date(lastActiveUtc);
  return last.getFullYear() === now.getFullYear() && last.getMonth() === now.getMonth() && last.getDate() === now.getDate() ? "clear" : "cloudy";
}

/**
 * The world behind the Hero panel (the two worlds, Stage 4): a flat pixel scene - sky, the arena's silhouette, two
 * torches - that follows your clock (dawn, day, dusk, night with stars) and your streak (clear, clouds, rain).
 * Decorative: screen readers skip it; it never moves under reduced motion.
 */
export default function HeroScene() {
  const streak = useHUDStore((s) => s.streakDays);
  const last = useHUDStore((s) => s.lastActiveUtc);
  const [time, setTime] = useState<DayTime>("night");
  useEffect(() => {
    const tick = () => setTime(dayTime(new Date().getHours()));
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);
  const weather = weatherOf(streak, last);
  return (
    <div className="hscene" data-time={time} data-weather={weather} aria-hidden="true" data-testid="hero-scene">
      <span className="hscene__sky" />
      {time === "night" && <span className="hscene__stars" />}
      <span className="hscene__orb" />
      {weather !== "clear" && <span className="hscene__clouds" />}
      {weather === "rain" && <span className="hscene__rain" />}
      <span className="hscene__arena" />
      <span className="hscene__torch hscene__torch--l" />
      <span className="hscene__torch hscene__torch--r" />
    </div>
  );
}
