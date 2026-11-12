"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Repeat, Skull, Sparkles } from "@/components/ui/icons";
import PixelSprite from "@/components/arena/pixel/PixelSprite";
import { portalClick } from "@/components/shell/PortalLink";
import { dueBadge, useReview } from "@/hooks/useReview";
import { useCourses } from "@/hooks/useCourses";
import { fetchInvasion } from "@/lib/arena/api";
import type { InvasionInfo } from "@/lib/arena/types";
import { ROUTES } from "@/lib/routes";

/** The document (or course) the bridges look at: your latest course. */
export function useBridgeDocument(): string | null {
  const { courses, loaded, load } = useCourses();
  useEffect(() => { if (!loaded) load().catch(() => {}); }, [loaded, load]);
  return courses[0]?.id ?? null;
}

/** This week's invasion on a document (null until it's known). */
export function useInvasion(sessionId: string | null): InvasionInfo | null {
  const [info, setInfo] = useState<InvasionInfo | null>(null);
  useEffect(() => {
    let alive = true;
    fetchInvasion(sessionId).then((r) => { if (alive) setInfo(r); }).catch(() => {});
    return () => { alive = false; };
  }, [sessionId]);
  return info;
}

/**
 * The light bridge (two worlds, Stage 5): reviews due in Study show up in the Hero world as a quest scroll. Answering
 * the call crosses the portal straight to Review.
 */
export function ReviewScroll() {
  const due = useReview((s) => dueBadge(s.stats));
  if (due <= 0) return null;
  const href = ROUTES.studyTab("review");
  return (
    <section className="bridge-card bridge-card--review" aria-labelledby="bridge-review-title">
      <Repeat size={22} aria-hidden="true" className="bridge-card__icon" />
      <div className="bridge-card__text">
        <h3 id="bridge-review-title" className="bridge-card__title pixel-font">{due} {due === 1 ? "review awaits" : "reviews await"}</h3>
        <p className="bridge-card__line">Cards from Study are due. Clear them for XP, and they fill your Insight.</p>
      </div>
      <Link href={href} className="bridge-card__go" onClick={portalClick("study", href)}>Answer the call</Link>
    </section>
  );
}

/** The weekly invasion as a Hero quest: who comes, made of what you studied; face it, or see what wakes it. */
export function InvasionCard() {
  const doc = useBridgeDocument();
  const info = useInvasion(doc);
  if (!info) return null;
  return (
    <section className="bridge-card bridge-card--invasion" aria-labelledby="bridge-invasion-title" data-state={info.repelled ? "repelled" : info.ready ? "ready" : "quiet"}>
      <span className="bridge-card__face" aria-hidden="true"><PixelSprite boss={info.species} portrait flip className="bridge-card__sprite" /></span>
      <div className="bridge-card__text">
        <h3 id="bridge-invasion-title" className="bridge-card__title pixel-font">
          {info.repelled ? "Invasion repelled" : info.ready ? `Invasion! The ${info.name} comes` : "Nothing stirs yet"}
        </h3>
        <p className="bridge-card__line">
          {info.repelled ? `You drove off this week's ${info.name}. Another comes next week.`
            : info.ready ? `Made of what you studied this week: ${info.concepts.join(", ")}. Repel it for +${info.reward.xp} XP and ${info.reward.coins} coins.`
            : `Study at least ${info.needed} concepts this week (${info.concepts.length}/${info.needed}) and something will come for them.`}
        </p>
      </div>
      {info.ready && !info.repelled && doc && (
        <Link href={`${ROUTES.heroArena}?invasion=1&doc=${encodeURIComponent(doc)}`} className="bridge-card__go"><Skull size={14} aria-hidden="true" />Face the invasion</Link>
      )}
    </section>
  );
}

/** Today's hint of the invasion (Study side): something stirs in the Hero world. */
export function InvasionTeaser() {
  const doc = useBridgeDocument();
  const info = useInvasion(doc);
  if (!info || !info.ready || info.repelled) return null;
  return (
    <p className="bridge-teaser" role="note">
      <Sparkles size={16} aria-hidden="true" />
      <span>Something stirs in the Hero world… a {info.name} comes for what you studied this week.</span>
      <Link href={ROUTES.heroQuests} onClick={portalClick("hero", ROUTES.heroQuests)}>See it</Link>
    </p>
  );
}
