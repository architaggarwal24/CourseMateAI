"use client";

import { useEffect, useState } from "react";
import { useReducedMotionConfig } from "motion/react";

/**
 * Text that types itself out, like an RPG's dialogue (the Hero world's speech boxes). The visible letters are
 * decorative; the whole text is there for screen readers from the start. Reduced motion: all of it at once.
 */
export default function Typewriter({ text, cps = 55 }: { text: string; cps?: number }) {
  const reduce = !!useReducedMotionConfig();
  const [n, setN] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce) { setN(text.length); return; }
    setN(0);
    const t = setInterval(() => setN((k) => { if (k >= text.length) { clearInterval(t); return k; } return k + 1; }), 1000 / cps);
    return () => clearInterval(t);
  }, [text, cps, reduce]);
  return (
    <>
      <span aria-hidden="true" className="typewriter" data-done={n >= text.length || undefined}>{text.slice(0, n)}<span className="typewriter__caret" /></span>
      <span className="sr-only">{text}</span>
    </>
  );
}
