"use client";

import { useSyncExternalStore } from "react";
import { shortcutLabel } from "@/lib/keys";

const noop = () => () => {};

/**
 * shortcutLabel for rendering: the server (which can't know the keyboard) and hydration use the neutral "Ctrl+K";
 * the browser then shows "⌘K" on a Mac, with no hydration mismatch.
 */
export function useShortcutLabel(keys: string[]): string {
  const key = keys.join(" ");
  return useSyncExternalStore(noop, () => shortcutLabel(key.split(" ")), () => key.split(" ").map((k) => (k === "mod" ? "Ctrl" : k === "shift" ? "Shift" : k)).join("+"));
}
