/**
 * Should a global keyboard shortcut (answer keys, move keys, flashcard arrows) ignore this key press?
 * Yes while the user is typing, while a modal / menu / listbox / tab list has the key, or while any modal dialog is open
 * (the Retreat confirmation, the command palette, an account menu): those own the keyboard.
 */
export function shortcutBlocked(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target instanceof HTMLElement ? e.target : null;
  if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return true;
  if (t?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tablist"], [cmdk-root]')) return true;
  return typeof document !== "undefined" && !!document.querySelector('[aria-modal="true"], [role="menu"][data-state="open"]');
}

/** True on a Mac (and iPad / iPhone keyboards), where shortcuts use ⌘ rather than Ctrl. */
export function isApple(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform) || /Macintosh|iPhone|iPad/.test(navigator.userAgent);
}

/** The modifier's label for this keyboard: "⌘" on Apple, "Ctrl" elsewhere. */
export const modKey = (): string => (isApple() ? "⌘" : "Ctrl");

/** A shortcut as people read it: ["mod", "K"] -> "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export function shortcutLabel(keys: string[]): string {
  const apple = isApple();
  const parts = keys.map((k) => (k === "mod" ? (apple ? "⌘" : "Ctrl") : k === "shift" ? (apple ? "⇧" : "Shift") : k));
  return apple ? parts.join("") : parts.join("+");
}
