// Study remembers what you were doing (round 7): for each course or PDF, each tool reopens its current session (the
// chat, the notes, the quiz half-way through) and whatever was typed but not sent - after switching tools, going to
// Hero, a reload or a restart, until New is pressed. History keeps the older sessions. Kept in this browser.
import { useCallback, useEffect, useRef, useState } from "react";
import { STORAGE_PREFIX } from "@/lib/study/sessions";

const activeKey = (tool: string, scope: string) => `${STORAGE_PREFIX}active_${tool}_${scope}`;
const draftKey = (tool: string, scope: string) => `${STORAGE_PREFIX}draft_${tool}_${scope}`;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* private mode / full: memory is a convenience */ }
}

/** The session this tool had open on this course or PDF, if it is still saved. */
export function activeSession(tool: string, scope: string | undefined): string | undefined {
  if (!scope || typeof window === "undefined") return undefined;
  const id = read(activeKey(tool, scope));
  return id && read(`${STORAGE_PREFIX}session_${id}`) !== null ? id : undefined;
}

export function rememberSession(tool: string, scope: string | undefined, id: string) {
  if (scope) write(activeKey(tool, scope), id);
}

/** New: the tool opens empty next time (the old session stays in History). */
export function forgetSession(tool: string, scope: string | undefined) {
  if (scope) write(activeKey(tool, scope), null);
}

export function loadDraft(tool: string, scope: string | undefined): string {
  return scope && typeof window !== "undefined" ? read(draftKey(tool, scope)) ?? "" : "";
}

export function saveDraft(tool: string, scope: string | undefined, text: string) {
  if (scope) write(draftKey(tool, scope), text.trim() ? text : null);
}

/**
 * A text box that keeps what was typed (per tool and course/PDF) until it is sent or cleared. `initial` (a topic
 * passed in, e.g. from the concept map) wins over the saved draft.
 */
export function useDraft(tool: string, scope: string | undefined, initial?: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => initial ?? loadDraft(tool, scope));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; if (initial === undefined) return; }
    saveDraft(tool, scope, value);
  }, [tool, scope, value, initial]);
  const set = useCallback((v: string) => setValue(v), []);
  return [value, set];
}
