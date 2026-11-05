"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { areaOf } from "@/lib/routes";
import UserMenu from "@/components/UserMenu";
import { usePointerVars } from "@/components/fx/usePointerVars";
import { dueBadge, useReview } from "@/hooks/useReview";
import { NAV_ITEMS } from "./nav-items";
import ReviewBadge from "./ReviewBadge";
import { openCommandPalette } from "./CommandPalette";
import { useShortcutLabel } from "@/hooks/useShortcutLabel";

/**
 * Desktop: a frosted rail down the left. Brand, a "Go to…" search (⌘K on a Mac, Ctrl+K elsewhere), the three areas (the active one rides a lit
 * sliding pill, the pointer casts a soft light over the rail; Study carries the review queue's due count), the
 * signed-in user pinned at the bottom. Hidden below md.
 */
export default function NavSidebar() {
  const paletteKey = useShortcutLabel(["mod", "K"]);
  const area = areaOf(usePathname());
  const pointer = usePointerVars<HTMLElement>();
  const due = useReview((s) => dueBadge(s.stats));
  return (
    <aside className="side fx-spotlight" ref={pointer}>
      <div className="side__brand">
        <div className="side__logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5V6a2 2 0 0 1 2-2h11l3 3v12.5" /><path d="M8 4v6l2.5-1.5L13 10V4" /><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20" />
          </svg>
        </div>
        <div className="side__wordmark">
          <span className="side__name">CourseMate</span>
          <span className="side__tag">AI study companion</span>
        </div>
      </div>

      <button type="button" className="side__search" onClick={openCommandPalette}>
        <Search size={15} aria-hidden="true" />
        <span>Go to…</span>
        <kbd className="kbd">{paletteKey}</kbd>
      </button>

      <nav aria-label="Main" className="side__nav">
        {NAV_ITEMS.map(({ id, label, href, Icon, blurb }) => (
          <Link key={id} href={href} aria-current={area === id ? "page" : undefined} className="side__link">
            {area === id && <motion.span layoutId="side-pill" className="side__pill" transition={{ type: "spring", stiffness: 420, damping: 38 }} />}
            <span className="side__icon"><Icon size={18} aria-hidden="true" /></span>
            <span className="side__text">
              <span>{label}</span>
              <span className="side__blurb">{blurb}</span>
            </span>
            {id === "study" && <ReviewBadge due={due} />}
          </Link>
        ))}
      </nav>

      <div className="side__foot">
        <UserMenu />
      </div>
    </aside>
  );
}
