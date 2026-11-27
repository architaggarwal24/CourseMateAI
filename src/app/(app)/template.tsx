"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { motion, useReducedMotionConfig } from "motion/react";
import { ARRIVE, MOTION } from "@/components/fx/motion";

// Client only: true once the first page has hydrated. The server never sets it, so every server render is visible.
let hydrated = false;

/**
 * Re-mounted on every navigation between pages (not between tabs, which live in the query string): the new page
 * rises in and fades up (the "route" motion: a page change should feel instant, under 300 ms). Reduced motion
 * (MotionConfig reducedMotion="user") turns it into an instant swap.
 *
 * The first page of a visit does not animate (nor do its .stage lists): its server HTML paints as it arrives, instead of waiting at opacity 0
 * for the JavaScript to load and fade it in (that cost seconds of blank screen on a slow phone).
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  // reducedMotion="user" only stops transforms; a fade is motion too, so it is skipped here as well.
  const reduce = useReducedMotionConfig();
  const [enter] = useState(() => typeof window !== "undefined" && hydrated);
  useEffect(() => { hydrated = true; }, []);
  // From the first in-app page change on, lists marked .stage arrive one item after another (components/ui/ui.css).
  // Set before this page paints, so its lists start at their first frame instead of flashing in full.
  useLayoutEffect(() => { if (enter) document.documentElement.dataset.nav = ""; }, [enter]);
  return (
    <motion.div
      className="app-page"
      initial={reduce || !enter ? false : ARRIVE.initial}
      animate={ARRIVE.animate}
      transition={{ ...ARRIVE.transition, duration: MOTION.base }}
    >
      {children}
    </motion.div>
  );
}
