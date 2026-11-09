"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui";

/** Elapsed whole seconds since `since`, ticking once a second. */
function useSeconds(since: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}

/**
 * What a Study tool shows while the AI writes (notes, a quiz, flashcards): what is being written, a calm page of
 * lines filling in, the time so far, and that it keeps going if you leave. Flat: no gradients or glows.
 */
export default function Writing({ what, topic, startedAt, steps }: { what: string; topic: string; startedAt: number; steps: string[] }) {
  const s = useSeconds(startedAt);
  // the form it replaces was taller: bring the panel into view (a phone was scrolled down to the button)
  const box = useRef<HTMLElement>(null);
  useEffect(() => { box.current?.scrollIntoView?.({ block: "nearest" }); }, []);
  const step = steps[Math.min(steps.length - 1, Math.floor(s / 6))];
  return (
    <section ref={box} className="study-writing" aria-labelledby="study-writing-h" aria-busy="true">
      <div className="study-writing__head">
        <span className="study-writing__pen" aria-hidden="true" />
        <div className="min-w-0">
          <h3 id="study-writing-h">Writing {what} on “{topic}”</h3>
          <p role="status" aria-live="polite">{step}</p>
        </div>
        <span className="study-writing__time" aria-label={`${s} seconds so far`}>{s}s</span>
      </div>
      <div className="study-writing__page" aria-hidden="true">
        {[92, 78, 85, 60, 88, 70].map((w, i) => <Skeleton key={i} height={12} style={{ width: `${w}%` }} />)}
      </div>
      <p className="study-writing__note">This usually takes under a minute. You can switch to another tool or go to Hero: it keeps going, and it&apos;s here when you come back.</p>
    </section>
  );
}
