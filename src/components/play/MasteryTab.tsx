"use client";

import { useMemo, useState } from "react";
import { Check, Crown, Lock, Sparkles, Swords, Zap } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { xpPct } from "@/components/arena/pixel/Roster";
import { useMyHeroLook } from "@/components/champion/useChampionLook";
import { Badge, Button, ButtonLink, EmptyState, Tabs } from "@/components/ui";
import { isUnlocked, useChampion, type ChampionProgress } from "@/hooks/useChampion";
import { useMyHero, type HeroView } from "@/hooks/useMyHero";
import { HERO_FIGHTER_ID, heroFighter } from "@/lib/pixel/appearance";
import { HEROES, type HeroDef } from "@/lib/pixel/heroes";
import { ROUTES } from "@/lib/routes";
import PixelLoader from "./PixelLoader";
import "@/components/arena/pixel/pixel.css";
import "@/components/champion/champion.css";

const pctOf = (p?: ChampionProgress) => Math.max(0, Math.min(100, p?.mastery_pct ?? 0));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One champion in the roster: portrait, name, and how far its mastery is. */
function RosterLabel({ name, sprite, meta, pct, locked, mastered }: { name: string; sprite: React.ReactNode; meta: string; pct: number; locked?: boolean; mastered?: boolean }) {
  return (
    <span className="mroster" data-locked={locked || undefined} data-mastered={mastered || undefined}>
      <span className="mroster__art">{sprite}</span>
      <span className="mroster__text">
        <span className="mroster__name">{name}{locked && <Lock size={10} aria-label="locked" />}{mastered && <Crown size={11} aria-label="mastered" />}</span>
        <span className="mroster__meta">{meta}</span>
        <span className="mroster__bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      </span>
    </span>
  );
}

/** The big mastery meter: the %, and the bar with the 50% and 100% marks. */
function Meter({ name, p }: { name: string; p: ChampionProgress }) {
  const pct = pctOf(p);
  return (
    <div className="mmeter" data-mastered={p.mastered || undefined}>
      <p className="mmeter__pct pixel-font">{p.mastered ? "Mastered" : `${pct}%`}<span className="mmeter__of">{name}&apos;s mastery</span></p>
      <div className="mmeter__bar" role="progressbar" aria-label={`${name}'s mastery`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
        <i style={{ left: "50%" }} data-reached={pct >= 50 || undefined} aria-hidden="true" />
      </div>
      <p className="mmeter__marks" aria-hidden="true"><span>0</span><span>50%</span><span>100%</span></p>
    </div>
  );
}

/** A champion's page in the Mastery tab: who they are, their road to 100% and what it pays. */
function ChampionDetail({ h, styleName }: { h: HeroDef; styleName?: string }) {
  const p = useChampion((s) => s.progress[h.id]);
  const progress = useChampion((s) => s.progress);
  const picked = useChampion((s) => s.championId) === h.id;
  const choose = useChampion((s) => s.choose);
  const open = isUnlocked(progress, h.id);
  if (!p) return <p className="m-0 text-sm text-fg-muted">Fight as {h.name} to start.</p>;
  const challenges = p.challenges ?? [];
  const done = challenges.filter((c) => c.done).length;
  return (
    <section className="mdetail" aria-label={h.name} data-locked={!open || undefined} style={{ "--hero-accent": h.accent } as React.CSSProperties}>
      <div className="mdetail__hero">
        <div className="mdetail__stage"><PixelSprite hero={h} anim="idle" fidget={open} still={!open} label={h.name} className="mdetail__sprite" /></div>
        <div className="mdetail__id">
          <h2 className="mdetail__name">{h.name}</h2>
          <p className="mdetail__title">{h.title}</p>
          <p className="ipv__tags">
            {p.mastered && <Badge tone="epic"><Crown size={12} aria-hidden="true" />Mastered</Badge>}
            {picked && <Badge tone="success">Fighting</Badge>}
            {!open && <Badge><Lock size={10} aria-hidden="true" />Locked</Badge>}
          </p>
          <span className="mastery-card__level">
            <span className="pixel-font">Lv {p.level}</span>
            <span className="px-hero-card__xp" aria-hidden="true"><span style={{ width: `${xpPct(p)}%` }} /></span>
            <span className="text-xs text-fg-muted">{p.wins} {p.wins === 1 ? "win" : "wins"}</span>
          </span>
          {open && !picked && <div><Button size="sm" onClick={() => void choose(h.id)}><Swords size={14} aria-hidden="true" />Fight as {h.name}</Button></div>}
        </div>
        {open && p.mastery_pct !== undefined && <Meter name={h.name} p={p} />}
      </div>

      {!open && p.unlock ? (
        <div className="munlock">
          <p className="hero-label">How {h.name} joins</p>
          <p className="m-0 text-fg">{p.unlock.how}</p>
          <div className="mmeter__bar" role="progressbar" aria-label={`${h.name} joins`} aria-valuemin={0} aria-valuemax={p.unlock.need} aria-valuenow={p.unlock.have}>
            <span style={{ width: `${Math.round((100 * p.unlock.have) / Math.max(1, p.unlock.need))}%` }} />
          </div>
          <p className="m-0 text-sm text-fg-muted">{p.unlock.have}/{p.unlock.need} so far</p>
          <div><ButtonLink size="sm" href={ROUTES.heroBestiary}>Open the Bestiary</ButtonLink></div>
        </div>
      ) : (
        <div className="mdetail__cols">
          <section aria-label="Challenges" className="mcol">
            <p className="hero-label">Challenges · {done}/{challenges.length} done · 30% of mastery</p>
            <ul className="mchallenges" aria-label={`${h.name}'s mastery challenges`}>
              {challenges.map((c) => (
                <li key={c.id} className="mchallenge" data-done={c.done || undefined}>
                  <span className="mchallenge__mark" aria-hidden="true">{c.done ? <Check size={12} /> : null}</span>
                  <span className="mchallenge__text">{c.text}</span>
                  <span className="mchallenge__count pixel-font">{c.done ? <span className="sr-only">done</span> : `${c.progress}/${c.target}`}</span>
                  {!c.done && <span className="mchallenge__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((100 * c.progress) / Math.max(1, c.target)))}%` }} /></span>}
                </li>
              ))}
            </ul>
            <p className="m-0 text-xs text-fg-muted">The other 70% is {h.name}&apos;s level: every fight as {h.name}, and your studying while {h.name} is your champion.</p>
          </section>
          <section aria-label="Rewards" className="mcol">
            <p className="hero-label">What mastery gives your hero</p>
            <ol className="mroad">
              <li data-reached={p.passive_learnable || undefined}>
                <span className="mroad__at pixel-font">50%</span>
                <span className="mroad__what"><strong><Zap size={13} aria-hidden="true" />{p.kit.passive.name}</strong><span>{p.kit.passive.text}</span><span className="mroad__note">Your hero can learn it</span></span>
              </li>
              <li data-reached={p.mastered || undefined}>
                <span className="mroad__at pixel-font">100%</span>
                <span className="mroad__what">
                  <strong><Swords size={13} aria-hidden="true" />{styleName ? `${styleName} style` : `${h.name}'s fighting style`}</strong>
                  <strong><Sparkles size={13} aria-hidden="true" />{p.kit.ultimate.name}</strong><span>{p.kit.ultimate.text}</span>
                  <span className="mroad__note">Plus {h.name}&apos;s emotes and look</span>
                </span>
              </li>
            </ol>
          </section>
        </div>
      )}
    </section>
  );
}

/** Your hero's page: its level, skill points, and every fighting style with how close it is. */
function HeroDetail({ v }: { v: HeroView }) {
  const { look, style } = useMyHeroLook();
  const picked = useChampion((s) => s.championId) === HERO_FIGHTER_ID;
  const choose = useChampion((s) => s.choose);
  const sprite = useMemo(() => heroFighter({ style: style ?? "apprentice", look }), [style, look]);
  const pct = v.next_level_xp ? Math.round((100 * v.level_xp) / v.next_level_xp) : 100;
  const free = v.skill_points - v.skill_spent;
  const styles = v.catalog.styles;
  return (
    <section className="mdetail" aria-label="Your hero" data-testid="mastery-hero" style={{ "--hero-accent": "var(--color-reward)" } as React.CSSProperties}>
      <div className="mdetail__hero">
        <div className="mdetail__stage"><PixelSprite hero={sprite} anim="idle" fidget label="Your hero" className="mdetail__sprite" /></div>
        <div className="mdetail__id">
          <h2 className="mdetail__name">Your hero</h2>
          <p className="mdetail__title">Built by you</p>
          <p className="ipv__tags">{picked && <Badge tone="success">Fighting</Badge>}</p>
          <span className="mastery-card__level">
            <span className="pixel-font">Lv {v.level}</span>
            <span className="px-hero-card__xp" role="progressbar" aria-label="Your hero's level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></span>
            <span className="text-xs text-fg-muted">{v.next_level_xp ? `${v.level_xp}/${v.next_level_xp} XP` : "Max level"}</span>
          </span>
          <div>
            <ButtonLink size="sm" href={ROUTES.heroChampion} onClick={() => { if (!picked) void choose(HERO_FIGHTER_ID); }}>
              {picked ? "Build your hero" : "Fight as your hero"}
            </ButtonLink>
          </div>
        </div>
        <dl className="mastery-stats">
          <div><dt>Skill points</dt><dd className="pixel-font">{free > 0 ? `${free} to spend` : `${v.skill_spent}/${v.skill_points}`}</dd></div>
          <div><dt>Styles</dt><dd className="pixel-font">{styles.filter((s) => s.owned).length}/{styles.length}</dd></div>
          <div><dt>Looks earned</dt><dd className="pixel-font">{v.looks_unlocked.length}/{HEROES.length}</dd></div>
        </dl>
      </div>
      <p className="m-0 text-sm text-fg-2">Your hero gets a quarter of all study XP, and every battle&apos;s XP when it fights. Mastering a champion teaches it that champion&apos;s style, ultimate and look.</p>
      <div>
        <p className="hero-label">Fighting styles</p>
        <ul className="mstyles" aria-label="Fighting styles">
          {styles.map((st) => (
            <li key={st.id} className="mstyle" data-owned={st.owned || undefined}>
              <PixelSprite hero={heroFighter({ style: st.id, look: v.look })} still className="mstyle__art" />
              <span className="mstyle__text">
                <span className="mstyle__name">{st.name}{st.owned && <Check size={12} aria-label="earned" />}</span>
                <span className="mstyle__how">{st.owned ? st.bonus : st.how}</span>
                {!st.owned && st.progress !== null && (
                  <span className="mchallenge__bar" role="progressbar" aria-label={`${st.name}: ${st.how}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={st.progress}>
                    <span style={{ width: `${st.progress}%` }} />
                  </span>
                )}
              </span>
              {!st.owned && st.progress !== null && <span className="mstyle__pct pixel-font">{st.progress}%</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The Mastery tab: a roster on the left (your hero and the six champions, each with how far its mastery is) and the
 * picked one's page beside it: its road to 100% (challenges), what 50% and 100% give your hero, or how it joins.
 */
export default function MasteryTab() {
  const progress = useChampion((s) => s.progress);
  const loaded = useChampion((s) => s.loaded);
  const championId = useChampion((s) => s.championId);
  const v = useMyHero((s) => s.view);
  const [sel, setSel] = useState<string | null>(null);
  if (!loaded) return <PixelLoader label="Reading the records" />;
  if (!Object.keys(progress).length) return <EmptyState title="No mastery yet" description="Sign in and fight a battle to start mastering champions." />;
  const mastered = HEROES.filter((h) => progress[h.id]?.mastered).length;
  const styleFor = (h: HeroDef) => v?.catalog.styles.find((s) => s.how.startsWith(cap(h.id)) || s.how.startsWith(h.name))?.name;
  const current = sel ?? (championId && (championId === HERO_FIGHTER_ID || progress[championId]) ? championId : HEROES[0].id);

  const tabs = [
    ...(v ? [{
      id: HERO_FIGHTER_ID,
      label: <RosterLabel name="Your hero" sprite={<PixelSprite hero={heroFighter({ style: v.build.style ?? "apprentice", look: v.look })} portrait still className="mroster__sprite" />}
        meta={`Lv ${v.level} · ${v.catalog.styles.filter((s) => s.owned).length}/${v.catalog.styles.length} styles`} pct={v.next_level_xp ? Math.round((100 * v.level_xp) / v.next_level_xp) : 100} />,
      content: <HeroDetail v={v} />,
    }] : []),
    ...HEROES.map((h) => {
      const p = progress[h.id];
      const locked = !isUnlocked(progress, h.id);
      return {
        id: h.id,
        label: <RosterLabel name={h.name} sprite={<PixelSprite hero={h} portrait still className="mroster__sprite" />} locked={locked} mastered={p?.mastered}
          meta={locked ? "Not joined yet" : p?.mastered ? "Mastered" : `${pctOf(p)}% · Lv ${p?.level ?? 1}`} pct={locked ? 0 : pctOf(p)} />,
        content: <ChampionDetail h={h} styleName={styleFor(h)} />,
      };
    }),
  ];

  return (
    <div className="mastery" data-testid="mastery">
      <header className="mastery-top">
        <p className="m-0"><strong className="pixel-font mastery__count">{mastered}/{HEROES.length}</strong> champions mastered</p>
        <p className="m-0 text-sm text-fg-muted">Mastery is 70% a champion&apos;s level and 30% its challenges. Mastering one teaches your hero its style, ultimate and look.</p>
      </header>
      <Tabs className="mastery-tabs" label="Champions" value={tabs.some((t) => t.id === current) ? current : tabs[0].id} onChange={setSel} tabs={tabs} />
    </div>
  );
}
