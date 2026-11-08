"use client";

import { useEffect, useState, type RefObject } from "react";

export interface SectionLink { id: string; label: string }

/**
 * The index of a long page whose sections scroll in their own container (`scroller`) while the index stays put: a
 * column beside the sections on wide screens, a row of chips above them on phones (account.css). It marks the
 * section in view (aria-current) and a click scrolls that section into view.
 */
export default function SectionIndex({ items, scroller, label }: {
  items: SectionLink[]; scroller: RefObject<HTMLElement | null>; label: string;
}) {
  const [active, setActive] = useState(items[0]?.id ?? "");

  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, number>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set((e.target as HTMLElement).id, e.isIntersecting ? e.intersectionRatio : 0);
      // The section most in view wins; ties go to the one higher up the page.
      let best = "", bestRatio = 0;
      for (const it of items) {
        const r = seen.get(it.id) ?? 0;
        if (r > bestRatio) { best = it.id; bestRatio = r; }
      }
      if (best) setActive(best);
    }, { root, threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: "0px 0px -40% 0px" });
    for (const it of items) {
      const el = root.querySelector<HTMLElement>(`#${CSS.escape(it.id)}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [items, scroller]);

  // Keep the active chip visible in the phone row.
  useEffect(() => {
    document.querySelector<HTMLElement>(`.section-index a[href="#${CSS.escape(active)}"]`)
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <nav aria-label={label} className="section-index">
      {items.map((it) => (
        <a key={it.id} href={`#${it.id}`} aria-current={active === it.id ? "true" : undefined}
           onClick={(e) => {
             const el = document.getElementById(it.id);
             if (!el) return;
             e.preventDefault();
             el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || document.documentElement.classList.contains("reduce-animations") ? "auto" : "smooth", block: "start" });
             setActive(it.id);
             history.replaceState(null, "", `#${it.id}`);
           }}>
          {it.label}
        </a>
      ))}
    </nav>
  );
}
