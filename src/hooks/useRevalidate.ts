"use client";
import { useEffect, useRef } from "react";

/** Two events within this window (focus and visibilitychange usually fire together) ask once. */
const DEDUPE_MS = 1000;

/**
 * Stale-while-revalidate: what is on screen stays, and `fn` asks the server again when the user comes back to the
 * tab (window focus, tab shown again) or the network comes back. Not on mount: the caller loads first.
 * Use it for lists and counts, never for money (coins, balances): those change only from the server's answer.
 */
export function useRevalidate(fn: () => void, enabled = true): void {
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });

  useEffect(() => {
    if (!enabled) return;
    let last = -Infinity;
    const run = () => {
      const now = Date.now();
      if (now - last < DEDUPE_MS) return;
      last = now;
      latest.current();
    };
    const onVisible = () => { if (document.visibilityState === "visible") run(); };
    window.addEventListener("focus", run);
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}
