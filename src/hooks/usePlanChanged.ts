"use client";
import { useEffect, useRef } from "react";
import { PLAN_CHANGED_EVENT } from "@/lib/planNotice";

/**
 * Run `fn` when the user's plan just went up (the "you've been upgraded" window opened). A screen showing a locked
 * feature passes its reload, so the feature appears without a page refresh.
 */
export function usePlanChanged(fn: () => void, enabled = true): void {
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  useEffect(() => {
    if (!enabled) return;
    const run = () => latest.current();
    window.addEventListener(PLAN_CHANGED_EVENT, run);
    return () => window.removeEventListener(PLAN_CHANGED_EVENT, run);
  }, [enabled]);
}
