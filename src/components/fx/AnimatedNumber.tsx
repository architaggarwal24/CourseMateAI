"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { animate } from "motion/react";
import { reducedMotion } from "./motion";

/**
 * A number that counts to its new value (coins, XP, scores). The text node is updated directly, so a fast-ticking
 * count never re-renders React. Screen readers get the final value only (aria-live is the caller's choice).
 */
export default function AnimatedNumber({ value, duration = 0.9, format = (n: number) => Math.round(n).toLocaleString(), className }: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(value);
  const [inView, setInView] = useState(false);
  // Count only once the number is on screen (where there is no IntersectionObserver - tests, old browsers - at once).
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setInView(true); io.disconnect(); } });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  // Layout effect: the count restarts before the browser paints the new value, so it never flashes the final number first.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!inView || reducedMotion()) { node.textContent = format(value); from.current = value; return; }
    const controls = animate(from.current, value, {
      duration, ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { node.textContent = format(v); },
    });
    from.current = value;
    return () => controls.stop();
  }, [value, inView]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{format(value)}</span>;
}
