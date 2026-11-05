"use client";

import { useEffect, useState } from "react";

/** Whole seconds left, counting down once a second from `seconds` (null = nothing to wait for -> 0). Restarts when `seconds` changes. */
export function useCountdown(seconds: number | null): number {
  const [left, setLeft] = useState(seconds ?? 0);

  useEffect(() => {
    setLeft(seconds ?? 0);
    if (!seconds || seconds <= 0) return;
    const end = Date.now() + seconds * 1000;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [seconds]);

  return left;
}
