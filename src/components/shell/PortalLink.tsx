"use client";

import { useEffect, useId, useState, type MouseEvent } from "react";
import Link from "next/link";
import { Sparkles } from "@/components/ui/icons";
import ChampionAvatar from "@/components/champion/ChampionAvatar";
import { usePortal } from "@/hooks/usePortal";
import { useHUDStore } from "@/hooks/useHUD";
import { dueBadge, useReview } from "@/hooks/useReview";
import { lastPage, otherWorld, rememberPage, WORLD_HOME, type World } from "@/lib/worlds";

/** Where the portal to a world leads: the last page you were on there (read after the first render, so the server
 *  and the first paint agree on the world's home). */
export function usePortalHref(to: World): string {
  const [href, setHref] = useState(WORLD_HOME[to]);
  useEffect(() => { setHref(lastPage(to)); }, [to]);
  return href;
}

/** Cross to a world now (the page you leave is remembered). */
export function portalCross(to: World, href: string) {
  rememberPage(otherWorld(to), window.location.pathname + window.location.search);
  usePortal.getState().cross(to, href);
}

/** A plain click crosses with the portal transition; a modified click (new tab, new window) is an ordinary link. */
export function portalClick(to: World, href: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    portalCross(to, href);
  };
}

/**
 * The portal between the two worlds: "Enter the Hero world" from Study, "Return to Study" from Hero. It goes back to
 * the page you were last on in that world, through the pixel transition. `peek`: hovering or focusing it shows a
 * glimpse of the other side (your champion from Study; the reviews waiting from Hero).
 */
export default function PortalLink({ to, className = "", compact = false, peek = true, label, rail = false }: {
  to: World; className?: string; compact?: boolean; peek?: boolean; label?: string;
  /** In a side panel: the label hides (a tooltip) when the panel is collapsed to its rail. */
  rail?: boolean;
}) {
  const href = usePortalHref(to);
  const id = useId();
  const name = label ?? (to === "hero" ? "Enter the Hero world" : "Return to Study");
  return (
    <span className="portal-wrap">
      <Link href={href} className={`portal ${className}`} data-portal={to} data-tip={name} onClick={portalClick(to, href)}
        aria-describedby={peek ? `${id}-peek` : undefined}>
        <span className="portal__ring" aria-hidden="true"><Sparkles size={compact ? 18 : 16} /></span>
        <span className={rail ? "side__label portal__label" : "portal__label"}>{name}</span>
      </Link>
      {peek && <PortalPeek id={`${id}-peek`} to={to} />}
    </span>
  );
}

/** A glimpse through the portal (shown on hover and focus; read as the link's description). */
function PortalPeek({ id, to }: { id: string; to: World }) {
  const level = useHUDStore((s) => s.level);
  const streak = useHUDStore((s) => s.streakDays);
  const due = useReview((s) => dueBadge(s.stats));
  return (
    <span id={id} role="tooltip" className="portal-peek" data-to={to}>
      {to === "hero" ? (
        <>
          <ChampionAvatar size={40} />
          <span className="portal-peek__text"><b>Your champion awaits.</b> Level {level}, {streak}-day streak.</span>
        </>
      ) : (
        <span className="portal-peek__text">
          <b>{due > 0 ? `${due} ${due === 1 ? "card" : "cards"} to review.` : "All caught up."}</b> Study picks up where you left off.
        </span>
      )}
    </span>
  );
}
