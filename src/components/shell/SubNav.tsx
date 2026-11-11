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
  /**
   * Tabs with the same group sit together in their own track, captioned by the group's name above it (Learn,
   * Practice): a heading, not a tab - it has no tab shape, sits outside the track, and names the group for screen
   * readers (role="group"). Hick's law: fewer things at a glance.
   */
  group?: string;
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
    const nav = strip.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !el) return;
    // the box that scrolls (the strip itself, or its list), measured on screen: offsetLeft would count from whatever
    // positioned ancestor the strip sits in (a pinned bar, its padding), and miss the centre
    const center = () => {
      let box: HTMLElement | null = el.parentElement;
      while (box && box !== nav && box.scrollWidth <= box.clientWidth) box = box.parentElement;
      if (!box || box.scrollWidth <= box.clientWidth) return;
      const delta = el.getBoundingClientRect().left - box.getBoundingClientRect().left - (box.clientWidth - el.offsetWidth) / 2;
      box.scrollTo?.({ left: box.scrollLeft + delta });
    };
    center();
    // a web font arriving late (the pixel font) widens the tabs: centre again once it has
    void document.fonts?.ready.then(center).catch(() => {});
  }, [currentHref]);
  const link = (item: SubNavItem) => (
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
  );

  // Grouped: one captioned track per group (consecutive items with the same group).
  if (items.some((i) => i.group)) {
    const groups: { name: string; items: SubNavItem[] }[] = [];
    for (const item of items) {
      const last = groups.at(-1);
      if (last && last.name === (item.group ?? "")) last.items.push(item);
      else groups.push({ name: item.group ?? "", items: [item] });
    }
    return (
      <nav ref={strip} aria-label={label} className={cn("ui-tabs__groups shrink-0 px-4", className)}>
        {groups.map((g, gi) => (
          <div key={`${g.name}-${gi}`} role="group" aria-labelledby={g.name ? `${barId}-g${gi}` : undefined} className="ui-tabs__grp">
            {g.name && <span id={`${barId}-g${gi}`} className="ui-tabs__cap">{g.name}</span>}
            <div className="ui-tabs__list ui-tabs__list--grp">{g.items.map(link)}</div>
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav ref={strip} aria-label={label} className={cn("ui-tabs__list shrink-0 px-4", className)}>
      {items.map(link)}
    </nav>
  );
}
