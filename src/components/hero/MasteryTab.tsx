"use client";

import { useMemo } from "react";
import { Crown, Lock } from "@/components/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { xpPct } from "@/components/arena/pixel/Roster";
import MasteryPanel from "@/components/champion/MasteryPanel";
import { useMyHeroLook } from "@/components/champion/useChampionLook";
import { Badge, Button, ButtonLink, EmptyState } from "@/components/ui";
import { isUnlocked, useChampion } from "@/hooks/useChampion";
import { useMyHero } from "@/hooks/useMyHero";
import { HERO_FIGHTER_ID, heroFighter } from "@/lib/pixel/appearance";
import { HEROES, type HeroDef } from "@/lib/pixel/heroes";
import { ROUTES } from "@/lib/routes";
import "@/components/arena/pixel/pixel.css";
import "@/components/champion/champion.css";

/** Your hero's progress: its level, the skill points still to spend, and the styles and looks it has earned. */
function HeroProgress() {
  const v = useMyHero((s) => s.view);
  const { look, style } = useMyHeroLook();
  const picked = useChampion((s) => s.championId) === HERO_FIGHTER_ID;
  const choose = useChampion((s) => s.choose);
  const sprite = useMemo(() => heroFighter({ style: style ?? "apprentice", look }), [style, look]);
  if (!v) return null;
  const pct = v.next_level_xp ? Math.round((100 * v.level_xp) / v.next_level_xp) : 100;
  const free = v.skill_points - v.skill_spent;
  const styles = v.catalog.styles.filter((s) => s.owned).length;
  return (
    <section className="mastery-card mastery-card--hero" aria-label="Your hero" data-testid="mastery-hero">
      <div className="mastery-card__top">
        <PixelSprite hero={sprite} portrait still className="mastery-card__art" />
        <div className="min-w-0 grid gap-1">
          <p className="m-0 flex flex-wrap items-center gap-2">
            <strong className="text-fg">Your hero</strong>
            <span className="text-xs text-fg-muted">Built by you</span>
            {picked && <Badge tone="success">Fighting</Badge>}
          </p>
          <span className="mastery-card__level">
            <span className="pixel-font">Lv {v.level}</span>
            <span className="px-hero-card__xp" role="progressbar" aria-label="Your hero's level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></span>
            <span className="text-xs text-fg-muted">{v.next_level_xp ? `${v.level_xp}/${v.next_level_xp} XP` : "Max level"}</span>
          </span>
        </div>
      </div>
      <dl className="mastery-stats">
        <div><dt>Skill points</dt><dd className="pixel-font">{free > 0 ? `${free} to spend` : `${v.skill_spent}/${v.skill_points}`}</dd></div>
        <div><dt>Styles</dt><dd className="pixel-font">{styles}/{v.catalog.styles.length}</dd></div>
        <div><dt>Looks earned</dt><dd className="pixel-font">{v.looks_unlocked.length}/{HEROES.length}</dd></div>
      </dl>
      <p className="m-0 text-xs text-fg-muted">Your hero gets a quarter of all study XP, and every battle&apos;s XP when it fights. Mastering a champion teaches it that champion&apos;s style, ultimate and look.</p>
      <div className="flex flex-wrap gap-2">
        <ButtonLink size="sm" href={ROUTES.heroChampion} onClick={() => { if (!picked) void choose(HERO_FIGHTER_ID); }}>
          {picked ? "Build your hero" : "Fight as your hero"}
        </ButtonLink>
      </div>
    </section>
  );
}

/** One champion: its mastery %, challenges and what 50% / 100% bring; locked champions say how they join. */
function ChampionMastery({ h }: { h: HeroDef }) {
  const p = useChampion((s) => s.progress[h.id]);
  const progress = useChampion((s) => s.progress);
  const picked = useChampion((s) => s.championId) === h.id;
  const choose = useChampion((s) => s.choose);
  const open = isUnlocked(progress, h.id);
  return (
    <section className="mastery-card" aria-label={h.name} data-mastered={p?.mastered || undefined} data-locked={!open || undefined}
      style={{ "--hero-accent": h.accent } as React.CSSProperties}>
      <div className="mastery-card__top">
        <PixelSprite hero={h} portrait still className="mastery-card__art" />
        <div className="min-w-0 grid gap-1">
          <p className="m-0 flex flex-wrap items-center gap-2">
            <strong className="text-fg">{h.name}</strong>
            <span className="text-xs text-fg-muted">{h.title}</span>
            {p?.mastered && <Badge tone="epic"><Crown size={12} aria-hidden="true" />Mastered</Badge>}
            {picked && <Badge tone="success">Fighting</Badge>}
          </p>
          {p && (
            <span className="mastery-card__level">
              <span className="pixel-font">Lv {p.level}</span>
              <span className="px-hero-card__xp" aria-hidden="true"><span style={{ width: `${xpPct(p)}%` }} /></span>
              <span className="text-xs text-fg-muted">{p.wins} {p.wins === 1 ? "win" : "wins"}</span>
            </span>
          )}
        </div>
      </div>
      {!open && p?.unlock ? (
        <p className="m-0 text-sm text-fg-2"><Lock size={12} className="inline" aria-hidden="true" /> {p.unlock.how} ({p.unlock.have}/{p.unlock.need})</p>
      ) : p?.mastery_pct !== undefined ? (
        <MasteryPanel name={h.name} p={p} brief />
      ) : (
        <p className="m-0 text-sm text-fg-muted">Fight as {h.name} to start.</p>
      )}
      {open && !picked && (
        <div><Button size="sm" onClick={() => void choose(h.id)}>Fight as {h.name}</Button></div>
      )}
    </section>
  );
}

/**
 * The Mastery tab: every champion's road to 100% (their challenges and what 50% and 100% unlock) and your hero's own
 * level, side by side, so you can see what to work toward next.
 */
export default function MasteryTab() {
  const progress = useChampion((s) => s.progress);
  const loaded = useChampion((s) => s.loaded);
  const mastered = HEROES.filter((h) => progress[h.id]?.mastered).length;
  if (!loaded) return <p role="status" className="p-6 text-fg-muted">Reading the records…</p>;
  if (!Object.keys(progress).length) return <EmptyState title="No mastery yet" description="Sign in and fight a battle to start mastering champions." />;
  return (
    <div className="mastery" data-testid="mastery">
      <p className="m-0 text-sm text-fg-2">
        <strong className="pixel-font mastery__count">{mastered}/{HEROES.length}</strong> champions mastered. A champion&apos;s mastery is 70% its level and 30% its challenges; studying counts toward the champion you fight as.
      </p>
      <div className="mastery-grid">
        <HeroProgress />
        {HEROES.map((h) => <ChampionMastery key={h.id} h={h} />)}
      </div>
    </div>
  );
}
