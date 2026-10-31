import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { useAuth } from "@/contexts/AuthContext";
import { fetchDocument, fetchDocuments, uploadPDF, type DocumentInfo } from "@/lib/api";
import { isInFlight, POLL_INTERVAL_MS, SLOW_POLL_AFTER, SLOW_POLL_INTERVAL_MS } from "@/lib/documents";

interface SessionStore {
  // ── Documents: the SERVER is the source of truth (status, filename, expiry). This is only a cache of
  // what it last said; nothing about a document is remembered client-side on its own.
  documents: Record<string, DocumentInfo>;      // keyed by session id (= document id)
  documentsOwner: string | null;                // whose documents these are; reset when the account changes
  documentsLoaded: boolean;
  loadDocuments: (owner: string) => Promise<void>;
  refreshDocument: (sessionId: string) => Promise<DocumentInfo | null>;
  /** Upload a PDF. With an id it replaces (or re-creates) that document; without one the server picks the id. */
  uploadDocument: (sessionId: string | undefined, file: File) => Promise<DocumentInfo>;
  clearDocuments: () => void;
}

// ── Polling: one timer per document that is still being processed ───────────────
interface Poller { timer?: ReturnType<typeof setTimeout>; polls: number; failures: number }
const pollers = new Map<string, Poller>();
const MAX_POLL_FAILURES = 5;

/** Stop following one document, or all of them (logout, tests). */
export function stopDocumentPolling(sessionId?: string) {
  const ids = sessionId ? [sessionId] : Array.from(pollers.keys());
  for (const id of ids) {
    clearTimeout(pollers.get(id)?.timer);
    pollers.delete(id);
  }
}

function startPolling(sessionId: string, get: () => SessionStore) {
  if (pollers.has(sessionId)) return;                 // already being followed (any number of components)
  const poller: Poller = { polls: 0, failures: 0 };
  pollers.set(sessionId, poller);

  const tick = async () => {
    if (pollers.get(sessionId) !== poller) return;    // stopped meanwhile
    poller.polls++;
    let doc: DocumentInfo | null | undefined;
    try {
      doc = await get().refreshDocument(sessionId);
      poller.failures = 0;
    } catch {
      if (++poller.failures >= MAX_POLL_FAILURES) { pollers.delete(sessionId); return; }
      doc = get().documents[sessionId];               // keep the last known state, try again
    }
    if (pollers.get(sessionId) !== poller) return;
    if (doc && isInFlight(doc.status)) {
      poller.timer = setTimeout(tick, poller.polls > SLOW_POLL_AFTER ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
    } else {
      pollers.delete(sessionId);                      // ready / failed / needs_reindex / gone: nothing left to wait for
    }
  };
  poller.timer = setTimeout(tick, POLL_INTERVAL_MS);
}

export const useSessionStore = create<SessionStore>()((set, get) => ({
  documents: {},
  documentsOwner: null,
  documentsLoaded: false,

  loadDocuments: async (owner: string) => {
    if (get().documentsOwner !== owner) {             // a different account: forget the previous one's documents
      stopDocumentPolling();
      set({ documents: {}, documentsOwner: owner, documentsLoaded: false });
    }
    if (get().documentsLoaded) return;
    const list = await fetchDocuments();
    if (get().documentsOwner !== owner) return;       // the account changed while we were waiting
    set({ documents: Object.fromEntries(list.map((d) => [d.id, d])), documentsLoaded: true });
    list.filter((d) => isInFlight(d.status)).forEach((d) => startPolling(d.id, get));
  },

  refreshDocument: async (sessionId: string) => {
    const doc = await fetchDocument(sessionId);
    const documents = { ...get().documents };
    if (doc) documents[sessionId] = doc;
    else delete documents[sessionId];                 // the server dropped it (expired): so do we
    set({ documents });
    return doc;
  },

  uploadDocument: async (sessionId: string | undefined, file: File) => {
    const { document } = await uploadPDF(file, sessionId);   // returns at once; indexing runs on the server
    set({ documents: { ...get().documents, [document.id]: document } });
    if (isInFlight(document.status)) startPolling(document.id, get);
    return document;
  },

  clearDocuments: () => {
    stopDocumentPolling();
    set({ documents: {}, documentsOwner: null, documentsLoaded: false });
  },
}));

const NO_DOCUMENTS: Record<string, DocumentInfo> = {};

/**
 * The logged-in user's documents as the server lists them (most recently used first). Loads the list once,
 * follows any document that is still being processed, and forgets everything when the account changes.
 */
export function useDocuments() {
  const { user } = useAuth();
  const owner = user ? String(user.user_id) : null;
  const loadDocuments = useSessionStore((s) => s.loadDocuments);
  const clearDocuments = useSessionStore((s) => s.clearDocuments);
  const documents = useSessionStore((s) => (s.documentsOwner === owner ? s.documents : NO_DOCUMENTS));
  const loaded = useSessionStore((s) => s.documentsOwner === owner && s.documentsLoaded);

  useEffect(() => {
    if (owner) loadDocuments(owner).catch(() => { /* offline: the upload button still works */ });
    else clearDocuments();                            // logged out: forget the last account's documents, stop polling
  }, [owner, loadDocuments, clearDocuments]);

  const list = useMemo(
    () => Object.values(documents).sort((a, b) => (a.last_used_at < b.last_used_at ? 1 : a.last_used_at > b.last_used_at ? -1 : 0)),
    [documents],
  );
  return { documents, list, loaded };
}

/** The server's view of one document (null when it has none with that id). */
export function useDocument(documentId: string | undefined) {
  const { documents, loaded } = useDocuments();
  return { document: documentId ? documents[documentId] ?? null : null, loaded };
}
