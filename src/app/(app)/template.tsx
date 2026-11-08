"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotionConfig } from "motion/react";

// Client only: true once the first page has hydrated. The server never sets it, so every server render is visible.
let hydrated = false;

/**
 * Re-mounted on every navigation between pages (not between tabs, which live in the query string): the new page
 * rises in out of a soft blur, in 250 ms (a page change should feel instant: under 300 ms). Reduced motion
 * (MotionConfig reducedMotion="user") turns it into an instant swap.
 *
 * The first page of a visit does not animate: its server HTML paints as it arrives, instead of waiting at opacity 0
 * for the JavaScript to load and fade it in (that cost seconds of blank screen on a slow phone).
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  // reducedMotion="user" only stops transforms; a fade and a blur are motion too, so they are skipped here as well.
  const reduce = useReducedMotionConfig();
  const [enter] = useState(() => typeof window !== "undefined" && hydrated);
  useEffect(() => { hydrated = true; }, []);
  return (
    <motion.div
      className="app-page"
      initial={reduce || !enter ? false : { opacity: 0, y: 10, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
