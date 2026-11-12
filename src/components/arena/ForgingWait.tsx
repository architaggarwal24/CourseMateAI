"use client";

import { useEffect, useState } from "react";
import LoreTip from "@/components/fx/LoreTip";

/**
 * Waiting while a fight is prepared: the server writes the whole fight's questions from the PDF before it starts (so
 * the fight itself never waits), which can take a while on a slow model. The wait says what is happening and how long
 * it has been, instead of a spinner that looks stuck.
 */
const STEPS = [
  { at: 0, text: "The beast circles you…" },
  { at: 3, text: "Reading your document…" },
  { at: 8, text: "Writing the whole fight's questions…" },
  { at: 30, text: "Slow model today. Still writing…" },
  { at: 60, text: "Almost there. If this fails, nothing is lost." },
];

export default function ForgingWait({ preparing = true }: { preparing?: boolean }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const text = preparing ? [...STEPS].reverse().find((s) => secs >= s.at)!.text : "The boss is choosing its next question…";
  return (
    <div className="arena-wait" role="status" aria-live="polite">
      <span className="arena-wait__orb" aria-hidden="true" />
      <span>{text}</span>
      {preparing && secs >= 3 && <span className="arena-wait__secs pixel-font" aria-hidden="true">{secs}s</span>}
      {preparing && <LoreTip />}
    </div>
  );
}
