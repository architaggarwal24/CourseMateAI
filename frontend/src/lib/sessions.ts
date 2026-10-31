import { Message, SessionMeta } from "@/types";

export const STORAGE_PREFIX = "cmai_";

function isClient(): boolean {
  return typeof window !== "undefined";
}

export function loadMetadata(): Record<string, SessionMeta & { title?: string }> {
  if (!isClient()) return {};
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}metadata`) || "{}");
  } catch {
    return {};
  }
}

export function saveMetadata(meta: Record<string, SessionMeta & { title?: string }>) {
  if (!isClient()) return;
  localStorage.setItem(`${STORAGE_PREFIX}metadata`, JSON.stringify(meta));
}

export function loadSession(sessionId: string): Message[] {
  if (!isClient()) return [];
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}session_${sessionId}`) || "[]");
  } catch {
    return [];
  }
}

export function saveSession(sessionId: string, messages: Message[], title?: string) {
  if (!isClient()) return;

  localStorage.setItem(`${STORAGE_PREFIX}session_${sessionId}`, JSON.stringify(messages));

  const meta = loadMetadata();
  const type = messages[0]?.type || "chat";

  let preview = "Empty session";
  for (const m of messages) {
    if (m.role === "user" && m.content.trim()) {
      preview = m.content.trim().slice(0, 60);
      if (m.content.length > 60) preview += "…";
      break;
    }
  }

  meta[sessionId] = { type, preview, updated: new Date().toISOString(), ...(title ? { title } : {}) };
  saveMetadata(meta);
}

/** Save non-chat session data (quiz results, notes, arena) with a preview string. */
export function saveSessionData(
  sessionId: string,
  type: string,
  preview: string,
  data: unknown,
  title?: string
) {
  if (!isClient()) return;

  localStorage.setItem(`${STORAGE_PREFIX}session_${sessionId}`, JSON.stringify(data));

  const meta = loadMetadata();
  meta[sessionId] = {
    type,
    preview: preview.slice(0, 60) + (preview.length > 60 ? "…" : ""),
    updated: new Date().toISOString(),
    ...(title ? { title } : {}),
  };
  saveMetadata(meta);
}

/** Load arbitrary saved data for non-chat sessions. */
export function loadSessionData<T = unknown>(sessionId: string): T | null {
  if (!isClient()) return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}session_${sessionId}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function deleteSession(sessionId: string) {
  if (!isClient()) return;
  localStorage.removeItem(`${STORAGE_PREFIX}session_${sessionId}`);
  // FIX BUG 40: Also delete the arena state stored under a separate key.
  // Previously deleteSession() left arena state orphaned in localStorage,
  // causing arena state to accumulate indefinitely.
  localStorage.removeItem(`${STORAGE_PREFIX}arena_${sessionId}`);
  const meta = loadMetadata();
  delete meta[sessionId];
  saveMetadata(meta);
}

// Arena-specific session storage (kept for backwards compat)
export function loadArenaState(sessionId: string): any {
  if (!isClient()) return null;
  try {
    const data = localStorage.getItem(`${STORAGE_PREFIX}arena_${sessionId}`);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function saveArenaState(sessionId: string, state: any) {
  if (!isClient()) return;
  localStorage.setItem(`${STORAGE_PREFIX}arena_${sessionId}`, JSON.stringify(state));
}

export function deleteArenaState(sessionId: string) {
  if (!isClient()) return;
  localStorage.removeItem(`${STORAGE_PREFIX}arena_${sessionId}`);
}
