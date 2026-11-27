"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Feedback = "success" | "error";

/**
 * A short-lived confirm state for a Button (redesign Stage 2): flash("success") after a save or a copy, flash("error")
 * when it failed. It clears itself after `ms`; a new flash restarts the clock. Pass `feedback` to <Button feedback>.
 * It is visual only: anything a screen reader must hear still goes in a toast or a live region.
 */
export function useFeedback(ms = 1600) {
  const [feedback, setFeedback] = useState<Feedback | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flash = useCallback((kind: Feedback) => {
    clearTimeout(timer.current);
    setFeedback(kind);
    timer.current = setTimeout(() => setFeedback(undefined), ms);
  }, [ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { feedback, flash };
}
