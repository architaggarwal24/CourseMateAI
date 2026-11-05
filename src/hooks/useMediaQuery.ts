"use client";
import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches, live. False on the server and where matchMedia does not exist. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = typeof window !== "undefined" ? window.matchMedia?.(query) : undefined;
      mql?.addEventListener("change", onChange);
      return () => mql?.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia?.(query)?.matches) === true,
    () => false,
  );
}
