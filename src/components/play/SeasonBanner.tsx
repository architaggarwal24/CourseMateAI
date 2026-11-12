"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Skull, Sparkles } from "@/components/ui/icons";
import { Button } from "@/components/ui";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { portalClick } from "@/components/shell/PortalLink";
import { fetchSeason } from "@/lib/arena/api";
import type { SeasonInfo } from "@/lib/arena/types";
import { ROUTES } from "@/lib/routes";

/** The season on now (null until known, or when none is on). */
export function useSeason(sessionId: string | null): SeasonInfo | null {
  const [info, setInfo] = useState<SeasonInfo | null>(null);
  useEffect(() => {
    let alive = true;
    fetchSeason(sessionId).then((r) => { if (alive) setInfo(r); }).catch(() => {});
    return () => { alive = false; };
  }, [sessionId]);
  return info;
}

/**
 * A seasonal event on the arena hub (the two worlds, Stage 7): its banner, its limited boss - made of what you
 * studied this month, fought on its own stage - and whether you've beaten it this season.
 */
export default function SeasonBanner({ sessionId, onFace, starting }: { sessionId: string | null; onFace: () => void; starting?: boolean }) {
  const info = useSeason(sessionId);
  const s = info?.season;
  if (!info || !s) return null;
  return (
    <section className="season-banner" aria-labelledby="season-title" style={{ "--season": s.tint } as React.CSSProperties} data-season={s.id}>
      <span className="season-banner__face" aria-hidden="true"><PixelSprite boss={s.boss} portrait flip className="season-banner__sprite" /></span>
      <div className="season-banner__text">
        <p className="season-banner__kicker pixel-font"><CalendarClock size={12} aria-hidden="true" />Limited event</p>
        <h3 id="season-title" className="season-banner__title pixel-font">{s.name}</h3>
        <p className="season-banner__line">{s.tagline}</p>
        <p className="season-banner__line season-banner__state">
          {info.beaten ? `${s.boss_name} is beaten this season.`
            : info.ready ? `${s.boss_name} waits. Win for +${s.reward.xp} XP and ${s.reward.coins} coins, once this season.`
            : `Study at least ${info.needed} concepts this month (${info.concepts?.length ?? 0}/${info.needed}) to call it out.`}
        </p>
      </div>
      {info.ready && !info.beaten && (
        <Button variant="primary" onClick={onFace} loading={starting}><Skull size={16} aria-hidden="true" />Face {s.boss_name}</Button>
      )}
    </section>
  );
}

/** Today's word of it (Study side): the Hero world has an event on. */
export function SeasonTeaser({ sessionId }: { sessionId: string | null }) {
  const info = useSeason(sessionId);
  const s = info?.season;
  if (!s || info?.beaten) return null;
  return (
    <p className="bridge-teaser season-teaser" role="note" style={{ "--season": s.tint } as React.CSSProperties}>
      <Sparkles size={16} aria-hidden="true" /><span>{s.name} is on in the Hero world: {s.boss_name} is out.</span>
      <Link href={ROUTES.heroArena} onClick={portalClick("hero", ROUTES.heroArena)}>See it</Link>
    </p>
  );
}
