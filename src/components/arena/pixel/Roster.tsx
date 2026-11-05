"use client";

import { useState } from "react";
import { lookFor } from "@/components/champion/useChampionLook";
import { useChampion } from "@/hooks/useChampion";
import { useHeroStore } from "@/hooks/useHero";
import { HEROES, type Style } from "@/lib/pixel/heroes";
import PixelSprite from "./PixelSprite";

/** Share of the way from this level to the next (100 at the top level). */
export function xpPct(p: { xp: number; level_xp: number; next_level_xp: number | null }): number {
  if (p.next_level_xp === null) return 100;
  return Math.max(0, Math.min(100, Math.round(((p.xp - p.level_xp) / Math.max(1, p.next_level_xp - p.level_xp)) * 100)));
}

const STYLE_LABEL: Record<Style, string> = { blade: "Swordsman", heavy: "Knight", lance: "Lancer", fist: "Brawler", mage: "Arcanist", twin: "Duelist" };

/**
 * Pick your champion: your avatar everywhere and the fighter you bring into the arena. A radio group (arrow keys
 * move); the choice is saved on your account. Each card shows that champion in your current skins.
 */
export function Roster() {
  const heroId = useChampion((s) => s.championId);
  const setHero = useChampion((s) => s.choose);
  const shop = useHeroStore((s) => s.shop);
  const progress = useChampion((s) => s.progress);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <section className="px-roster" aria-labelledby="px-roster-title">
      <h3 id="px-roster-title" className="px-section-title pixel-font">Choose your champion</h3>
      <div className="px-roster__grid" role="radiogroup" aria-labelledby="px-roster-title">
        {HEROES.map((base) => {
          const h = lookFor(base.id, shop).hero;
          const on = h.id === heroId;
          return (
            <button
              key={h.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
              className="px-hero-card" style={{ "--hero-accent": h.accent } as React.CSSProperties}
              onClick={() => { void setHero(h.id); }}
              onMouseEnter={() => setHover(h.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(h.id)} onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                const i = HEROES.findIndex((x) => x.id === h.id);
                const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const n = HEROES[(i + d + HEROES.length) % HEROES.length];
                void setHero(n.id);
                (e.currentTarget.parentElement?.querySelector(`[data-hero="${n.id}"]`) as HTMLElement | null)?.focus();
              }}
              data-hero={h.id}
            >
              <span className="px-hero-card__stage" aria-hidden="true">
                <PixelSprite hero={h} anim={hover === h.id ? "attack" : on ? "win" : "idle"} className="px-hero-card__sprite" />
              </span>
              <span className="px-hero-card__name pixel-font">{h.name}</span>
              {progress[h.id] && (
                <span className="px-hero-card__level">
                  <span className="sr-only">Level {progress[h.id].level}</span>
                  <span className="pixel-font" aria-hidden="true">Lv {progress[h.id].level}</span>
                  <span className="px-hero-card__xp" aria-hidden="true">
                    <span style={{ width: `${xpPct(progress[h.id])}%` }} />
                  </span>
                </span>
              )}
              <span className="px-hero-card__style">{STYLE_LABEL[h.style]}</span>
              <span className="px-hero-card__blurb">{h.blurb}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
