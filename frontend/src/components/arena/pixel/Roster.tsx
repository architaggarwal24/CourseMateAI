"use client";

import { useState } from "react";
import { HEROES, type Style } from "@/lib/pixel/heroes";
import { useArenaHero } from "@/hooks/useArenaHero";
import PixelSprite from "./PixelSprite";

const STYLE_LABEL: Record<Style, string> = { blade: "Swordsman", heavy: "Knight", lance: "Lancer", fist: "Brawler", mage: "Arcanist", twin: "Duelist" };

/** Pick the fighter you bring into the arena. A radio group: arrow keys move, the choice is kept in this browser. */
export function Roster() {
  const { heroId, setHero } = useArenaHero();
  const [hover, setHover] = useState<string | null>(null);
  return (
    <section className="px-roster" aria-labelledby="px-roster-title">
      <h3 id="px-roster-title" className="px-section-title pixel-font">Choose your champion</h3>
      <div className="px-roster__grid" role="radiogroup" aria-labelledby="px-roster-title">
        {HEROES.map((h) => {
          const on = h.id === heroId;
          return (
            <button
              key={h.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
              className="px-hero-card" style={{ "--hero-accent": h.accent } as React.CSSProperties}
              onClick={() => setHero(h.id)}
              onMouseEnter={() => setHover(h.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(h.id)} onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                const i = HEROES.findIndex((x) => x.id === h.id);
                const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const n = HEROES[(i + d + HEROES.length) % HEROES.length];
                setHero(n.id);
                (e.currentTarget.parentElement?.querySelector(`[data-hero="${n.id}"]`) as HTMLElement | null)?.focus();
              }}
              data-hero={h.id}
            >
              <span className="px-hero-card__stage" aria-hidden="true">
                <PixelSprite hero={h} anim={hover === h.id ? "attack" : on ? "win" : "idle"} key={`${h.id}-${hover === h.id}-${on}`} className="px-hero-card__sprite" />
              </span>
              <span className="px-hero-card__name pixel-font">{h.name}</span>
              <span className="px-hero-card__style">{STYLE_LABEL[h.style]}</span>
              <span className="px-hero-card__blurb">{h.blurb}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
