"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, type MouseEvent } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface SubNavItem {
  href: string;
  label: string;
  /** Extra path prefixes that also mark this item as current (e.g. a section's detail pages). */
  match?: string[];
  /** "exact" (default): only that path. "prefix": that path and everything under it. */
  mode?: "exact" | "prefix";
  /** When set, decides "current" itself (for tabs that differ by query string, not by path). */
  current?: boolean;
  /** A count shown beside the label (e.g. cards due), with its meaning for screen readers. */
  badge?: { count: number; label: string };
}

function isCurrent(pathname: string, item: SubNavItem) {
  if (item.current !== undefined) return item.current;
  const paths = [item.href, ...(item.match ?? [])];
  return paths.some(p => (item.mode === "prefix" ? pathname === p || pathname.startsWith(`${p}/`) : pathname === p));
}

/** Link-based tabs for an area's sections. Each tab is a real URL, so deep links and refresh work. */
export default function SubNav({ label, items, className, onNavigate }: {
  label: string;
  items: SubNavItem[];
  className?: string;
  /** Called on a plain click before the link is followed; call event.preventDefault() to stay (an unsaved-changes guard). */
  onNavigate?: (item: SubNavItem, event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const pathname = usePathname();
  const barId = useId();
  // On a narrow screen the strip scrolls sideways: keep the current tab in view (Review and Exam sit at the end).
  const strip = useRef<HTMLElement>(null);
  const currentHref = items.find((i) => isCurrent(pathname, i))?.href;
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && strip.current && strip.current.scrollWidth > strip.current.clientWidth) {
      strip.current.scrollTo?.({ left: el.offsetLeft - (strip.current.clientWidth - el.offsetWidth) / 2 });
    }
  }, [currentHref]);
  return (
    <nav ref={strip} aria-label={label} className={cn("ui-tabs__list shrink-0 px-4", className)}>
      {items.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className="ui-tab"
          aria-current={isCurrent(pathname, item) ? "page" : undefined}
          onClick={onNavigate ? (e) => onNavigate(item, e) : undefined}
        >
          {item.label}
          {item.badge && item.badge.count > 0 && (
            <span className="ui-tab__badge"><span aria-hidden="true">{item.badge.count > 99 ? "99+" : item.badge.count}</span>
              <span className="sr-only">, {item.badge.label}</span></span>
          )}
          {isCurrent(pathname, item) && <motion.span layoutId={`${barId}-bar`} className="ui-tab__bar" transition={{ type: "spring", stiffness: 520, damping: 40 }} aria-hidden="true" />}
        </Link>
      ))}
    </nav>
  );
}
