"use client";

import { useCallback, useRef } from "react";

/**
 * Pointer-driven CSS variables for an element: --mx / --my (pointer position in px inside it) and --hover (0 or 1).
 * Returns a ref callback. Writes happen at most once per frame and never re-render React.
 * Pair with the .fx-spotlight class (components/fx/fx.css) or read the variables in your own CSS.
 */
export function usePointerVars<T extends HTMLElement = HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((node: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!node) return;
    let frame = 0;
    let x = 0, y = 0;
    const write = () => {
      frame = 0;
      node.style.setProperty("--mx", `${x}px`);
      node.style.setProperty("--my", `${y}px`);
    };
    const move = (e: PointerEvent) => {
      const r = node.getBoundingClientRect();
      x = e.clientX - r.left;
      y = e.clientY - r.top;
      if (!frame) frame = requestAnimationFrame(write);
    };
    const enter = () => node.style.setProperty("--hover", "1");
    const leave = () => node.style.setProperty("--hover", "0");
    node.addEventListener("pointermove", move, { passive: true });
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    cleanup.current = () => {
      if (frame) cancelAnimationFrame(frame);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
    };
  }, []);
}
