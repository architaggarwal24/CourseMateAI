// FIX BUG-F03: Import STORAGE_PREFIX from sessions.ts instead of duplicating it.
// A local duplicate would silently diverge if sessions.ts ever changes the prefix.
import { STORAGE_PREFIX } from "./sessions";

export function cleanupEmptySessions() {
  if (typeof window === "undefined") return;
  
  try {
    const meta = JSON.parse(
      localStorage.getItem(`${STORAGE_PREFIX}metadata`) || "{}"
    );
    
    const cleaned: Record<string, any> = {};
    
    for (const [sessionId, sessionMeta] of Object.entries(meta)) {
      // Check if session has actual messages
      const messages = JSON.parse(
        localStorage.getItem(`${STORAGE_PREFIX}session_${sessionId}`) || "[]"
      );
      
      // Keep session if it has user messages
      const hasUserMessages = messages.some(
        (m: any) => m.role === "user" && m.content.trim()
      );
      
      if (hasUserMessages) {
        cleaned[sessionId] = sessionMeta;
      } else {
        // Remove empty session
        localStorage.removeItem(`${STORAGE_PREFIX}session_${sessionId}`);
      }
    }
    
    localStorage.setItem(`${STORAGE_PREFIX}metadata`, JSON.stringify(cleaned));
    console.log("Cleaned up empty sessions");
  } catch (error) {
    console.error("Failed to cleanup sessions:", error);
  }
}

const MAX_SESSIONS = 25;
const MAX_SESSION_AGE_DAYS = 30;

/**
 * Remove sessions older than MAX_SESSION_AGE_DAYS and enforce MAX_SESSIONS cap.
 * Called on app load to prevent localStorage from filling silently.
 */
export function cleanupOldSessions() {
  if (typeof window === "undefined") return;
  try {
    const meta: Record<string, any> = JSON.parse(
      localStorage.getItem(`${STORAGE_PREFIX}metadata`) || "{}"
    );
    const cutoff = Date.now() - MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000;
    const entries = Object.entries(meta);

    // Remove sessions older than cutoff
    const fresh = entries.filter(([, m]) => {
      const ts = m?.updatedAt ? new Date(m.updatedAt).getTime() : 0;
      return ts > cutoff;
    });

    // Enforce session cap — keep most recently updated
    const capped = fresh
      .sort(([, a], [, b]) =>
        new Date(b?.updatedAt || 0).getTime() - new Date(a?.updatedAt || 0).getTime()
      )
      .slice(0, MAX_SESSIONS);

    // Delete evicted sessions from storage
    const kept = new Set(capped.map(([id]) => id));
    for (const [id] of entries) {
      if (!kept.has(id)) {
        localStorage.removeItem(`${STORAGE_PREFIX}session_${id}`);
      }
    }

    const newMeta = Object.fromEntries(capped);
    localStorage.setItem(`${STORAGE_PREFIX}metadata`, JSON.stringify(newMeta));
  } catch (e) {
    console.error("cleanupOldSessions failed:", e);
  }
}