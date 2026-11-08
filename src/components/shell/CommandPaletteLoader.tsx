"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// The palette (cmdk and a Radix dialog) is not part of the first load of every page: it loads when the browser is
// idle, or at once on the first ⌘K / Ctrl+K or a click on the sidebar's search button.
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });
const load = () => import("./CommandPalette");

export const PALETTE_EVENT = "cmai:command-palette";

/** Open the palette from anywhere (the sidebar's search button). */
export const openCommandPalette = () => window.dispatchEvent(new Event(PALETTE_EVENT));

/** True for ⌘K / Ctrl+K when no other dialog owns the keyboard (two focus traps would fight). */
export function isPaletteKey(e: KeyboardEvent): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return false;
  return !document.querySelector('[aria-modal="true"]:not(.cmdk-dialog)');
}

export default function CommandPaletteLoader() {
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (opened) return;                              // from here on the palette listens for itself
    const onKey = (e: KeyboardEvent) => { if (isPaletteKey(e)) { e.preventDefault(); setOpened(true); } };
    const onOpen = () => setOpened(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    // Fetch the code while nothing else is happening, so the first ⌘K opens without a wait.
    const idle = window.requestIdleCallback?.(() => void load(), { timeout: 5000 });
    const t = idle === undefined ? window.setTimeout(() => void load(), 3000) : undefined;
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (t !== undefined) window.clearTimeout(t);
    };
  }, [opened]);

  return opened ? <CommandPalette defaultOpen /> : null;
}
