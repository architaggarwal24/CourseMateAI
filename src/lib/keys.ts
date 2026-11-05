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
