"use client";

import { useState } from "react";
import { lookFor, useMyHeroLook } from "@/components/champion/useChampionLook";
import { useMyHero } from "@/hooks/useMyHero";
import { HERO_FIGHTER_ID } from "@/lib/pixel/appearance";
import { Lock } from "@/components/ui/icons";
import { isUnlocked, useChampion } from "@/hooks/useChampion";
import { useHeroStore } from "@/hooks/useHero";
import { HEROES, type Style } from "@/lib/pixel/heroes";
import PixelSprite from "./PixelSprite";

/** Share of the way from this level to the next (100 at the top level). */
export function xpPct(p: { xp: number; level_xp: number; next_level_xp: number | null }): number {
  if (p.next_level_xp === null) return 100;
  return Math.max(0, Math.min(100, Math.round(((p.xp - p.level_xp) / Math.max(1, p.next_level_xp - p.level_xp)) * 100)));
}

export const STYLE_LABEL: Record<Style, string> = {
  blade: "Swordsman", heavy: "Knight", lance: "Lancer", fist: "Brawler", mage: "Arcanist", twin: "Duelist",
  sword: "Apprentice", whip: "Whipmaster", fan: "Fan dancer", kamas: "Reaper",
};

/**
 * Pick your champion: your avatar everywhere and the fighter you bring into the arena. A radio group (arrow keys
 * move); the choice is saved on your account. Each card shows that champion in your current skins. A champion who
 * hasn't joined yet is a dark silhouette with what brings them (arrow keys skip it; a click says what is left).
 */
export function Roster() {
  const heroId = useChampion((s) => s.championId);
  const setHero = useChampion((s) => s.choose);
  const shop = useHeroStore((s) => s.shop);
  const progress = useChampion((s) => s.progress);
  const mine = useMyHeroLook();
  const [hover, setHover] = useState<string | null>(null);
  return (
    <section className="px-roster" aria-labelledby="px-roster-title">
      <h3 id="px-roster-title" className="px-section-title pixel-font">Choose your champion</h3>
      <div className="px-roster__grid" role="radiogroup" aria-labelledby="px-roster-title">
        {HEROES.map((base) => {
          const h = lookFor(base.id, shop).hero;
          const on = h.id === heroId;
          const lock = progress[h.id]?.unlock;
          const locked = !isUnlocked(progress, h.id);
          return (
            <button
              key={h.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
              aria-disabled={locked || undefined} data-locked={locked || undefined}
              aria-describedby={locked ? `px-lock-${h.id}` : undefined}
              className="px-hero-card" style={{ "--hero-accent": locked ? "var(--color-muted)" : h.accent } as React.CSSProperties}
              onClick={() => { void setHero(h.id); }}
              onMouseEnter={() => setHover(h.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(h.id)} onBlur={() => setHover(null)}
              onKeyDown={(e) => {
                const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                // like any radio group, the arrows pass over the champions you can't pick yet
                const open = [...HEROES.filter((x) => isUnlocked(progress, x.id) || x.id === h.id).map((x) => x.id), HERO_FIGHTER_ID];
                const i = open.indexOf(h.id);
                const n = open[(i + d + open.length) % open.length];
                void setHero(n);
                (e.currentTarget.parentElement?.querySelector(`[data-hero="${n}"]`) as HTMLElement | null)?.focus();
              }}
              data-hero={h.id}
            >
              <span className="px-hero-card__stage" aria-hidden="true">
                <PixelSprite hero={h} anim={locked ? "idle" : hover === h.id ? "attack" : on ? "win" : "idle"} className="px-hero-card__sprite" />
              </span>
              <span className="px-hero-card__name pixel-font">{h.name}</span>
              {locked && lock ? (
                <span className="px-hero-card__lock" id={`px-lock-${h.id}`}>
                  <span className="px-hero-card__lockline"><Lock size={12} aria-hidden="true" /><span className="sr-only">Locked. </span>{lock.how}</span>
                  {lock.need > 1 && (
                    <span className="px-hero-card__level">
                      <span className="sr-only">{`${lock.have} of ${lock.need}`}</span>
                      <span className="px-hero-card__xp" aria-hidden="true"><span style={{ width: `${Math.round((100 * lock.have) / lock.need)}%` }} /></span>
                      <span className="text-xs" aria-hidden="true">{lock.have}/{lock.need}</span>
                    </span>
                  )}
                </span>
              ) : progress[h.id] && (
                <span className="px-hero-card__level">
                  <span className="sr-only">Level {progress[h.id].level}</span>
                  <span className="pixel-font" aria-hidden="true">Lv {progress[h.id].level}</span>
                  <span className="px-hero-card__xp" aria-hidden="true">
                    <span style={{ width: `${xpPct(progress[h.id])}%` }} />
                  </span>
                  {progress[h.id].mastery_pct !== undefined && (
                    <span className="px-hero-card__mastery" data-mastered={progress[h.id].mastered || undefined}>
                      {progress[h.id].mastered ? "Mastered" : `${progress[h.id].mastery_pct}%`}<span className="sr-only"> mastery</span>
                    </span>
                  )}
                </span>
              )}
              <span className="px-hero-card__style">{STYLE_LABEL[h.style]}</span>
              <span className="px-hero-card__blurb">{h.blurb}</span>
            </button>
          );
        })}
        <HeroCard on={heroId === HERO_FIGHTER_ID} hover={hover === HERO_FIGHTER_ID} setHover={setHover} mine={mine} />
      </div>
    </section>
  );
}

/** Your hero's card: always there, its level and style, drawn from the look you built. */
function HeroCard({ on, hover, setHover, mine }: { on: boolean; hover: boolean; setHover: (id: string | null) => void; mine: ReturnType<typeof useMyHeroLook> }) {
  const shop = useHeroStore((s) => s.shop);
  const setHero = useChampion((s) => s.choose);
  const view = useMyHero((s) => s.view);
  const progress = useChampion((s) => s.progress);
  const h = lookFor(HERO_FIGHTER_ID, shop, null, mine).hero;
  const style = view?.catalog.styles.find((x) => x.id === view.build.style)?.name ?? "Apprentice Blade";
  return (
    <button
      type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-hero={HERO_FIGHTER_ID}
      className="px-hero-card px-hero-card--mine" style={{ "--hero-accent": h.accent } as React.CSSProperties}
      onClick={() => { void setHero(HERO_FIGHTER_ID); }}
      onMouseEnter={() => setHover(HERO_FIGHTER_ID)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(HERO_FIGHTER_ID)} onBlur={() => setHover(null)}
      onKeyDown={(e) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        // the hero is the last card: right wraps to the first champion who has joined, left goes back to the last
        const open = HEROES.filter((x) => isUnlocked(progress, x.id));
        const n = d > 0 ? open[0] : open[open.length - 1];
        if (!n) return;
        void setHero(n.id);
        (e.currentTarget.parentElement?.querySelector(`[data-hero="${n.id}"]`) as HTMLElement | null)?.focus();
      }}
    >
      <span className="px-hero-card__stage" aria-hidden="true">
        <PixelSprite hero={h} anim={hover ? "attack" : on ? "win" : "idle"} className="px-hero-card__sprite" />
      </span>
      <span className="px-hero-card__name pixel-font">Your hero</span>
      {view && (
        <span className="px-hero-card__level">
          <span className="sr-only">Level {view.level}</span>
          <span className="pixel-font" aria-hidden="true">Lv {view.level}</span>
          <span className="px-hero-card__xp" aria-hidden="true"><span style={{ width: `${view.next_level_xp ? Math.round((100 * view.level_xp) / view.next_level_xp) : 100}%` }} /></span>
        </span>
      )}
      <span className="px-hero-card__style">{style}</span>
      <span className="px-hero-card__blurb">Built by you: your look, your style, your skills.</span>
    </button>
  );
}
