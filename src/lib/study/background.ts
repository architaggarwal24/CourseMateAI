"use client";
// Study work keeps going while you look elsewhere (round 7): notes, a quiz or flashcards being written, and a chat
// answer being streamed, carry on when you switch tools, go to Hero or open another course (while the app is open; a
// closed tab stops them). The view that started a job may be gone when it finishes: the result is saved to History
// and remembered as that tool's open session (lib/study/memory.ts), so the tool shows it when you come back; if no
// view is watching, a toast says it's ready.
import { useEffect, useSyncExternalStore } from "react";

type Listener = () => void;

/** A tiny observable map: one entry per key, views subscribe to the keys they show. */
function observable<T>() {
  const values = new Map<string, T>();
  const listeners = new Map<string, Set<Listener>>();
  const notify = (key: string) => listeners.get(key)?.forEach((l) => l());
  return {
    get: (key: string) => values.get(key),
    set(key: string, value: T | undefined) {
      if (value === undefined) values.delete(key); else values.set(key, value);
      notify(key);
    },
    subscribe(key: string, l: Listener) {
      const set = listeners.get(key) ?? new Set();
      set.add(l);
      listeners.set(key, set);
      return () => { set.delete(l); if (!set.size) listeners.delete(key); };
    },
    watched: (key: string) => (listeners.get(key)?.size ?? 0) > 0,
    clear() { values.clear(); },
  };
}

// ── Jobs: one generation per tool and course/PDF ─────────────────────────────────────────────────────────────
export interface Job { status: "running" | "done" | "failed"; label: string; sessionId?: string; startedAt: number; /** what kind (e.g. the notes' format) */ meta?: string }
const jobs = observable<Job>();
const jobKey = (tool: string, scope: string | undefined) => `${tool}:${scope ?? ""}`;

/** The job this tool has on this course / PDF (running, or finished and not yet picked up). */
export function useJob(tool: string, scope: string | undefined): Job | undefined {
  const key = jobKey(tool, scope);
  return useSyncExternalStore((l) => jobs.subscribe(key, l), () => jobs.get(key), () => undefined);
}

/** The view picked up the finished job (it shows the result now). */
export function clearJob(tool: string, scope: string | undefined) {
  const key = jobKey(tool, scope);
  if (jobs.get(key)?.status !== "running") jobs.set(key, undefined);
}

export const isRunning = (tool: string, scope: string | undefined) => jobs.get(jobKey(tool, scope))?.status === "running";

/**
 * Start a job: `work` makes the thing and saves it (History + memory), answering its session id. Errors go to
 * `onError` (the usual error toast, with a retry). When nobody is watching at the end, `ready` says so in a toast.
 */
export function startJob(tool: string, scope: string | undefined, label: string, work: () => Promise<string>, hooks: {
  onError: (e: unknown) => void; ready: (label: string) => void; meta?: string;
}): void {
  const key = jobKey(tool, scope);
  if (jobs.get(key)?.status === "running") return;
  const startedAt = Date.now();
  const meta = hooks.meta;
  jobs.set(key, { status: "running", label, startedAt, meta });
  work().then(
    (sessionId) => {
      const watched = jobs.watched(key);
      jobs.set(key, { status: "done", label, sessionId, startedAt, meta });
      if (!watched) hooks.ready(label);
    },
    (e) => {
      jobs.set(key, { status: "failed", label, startedAt, meta });
      hooks.onError(e);
    },
  );
}

// ── Live chat answers ─────────────────────────────────────────────────────────────────────────────────────────
/** A conversation while its answer is being written (the view may come and go meanwhile). */
export interface LiveChat<M> { messages: M[]; followUps: string[]; failure: { error: unknown; question: string } | null; loading: boolean }
const chats = observable<LiveChat<unknown>>();

export function liveChat<M>(chatId: string): LiveChat<M> | undefined {
  return chats.get(chatId) as LiveChat<M> | undefined;
}
export function setLiveChat<M>(chatId: string, value: LiveChat<M> | undefined) {
  chats.set(chatId, value as LiveChat<unknown> | undefined);
}
export const chatWatched = (chatId: string) => chats.watched(chatId);

/** Follow a live conversation: `apply` gets each change while an answer for `chatId` is being written. */
export function useLiveChat<M>(chatId: string, apply: (c: LiveChat<M>) => void) {
  useEffect(() => chats.subscribe(chatId, () => {
    const c = chats.get(chatId);
    if (c) apply(c as LiveChat<M>);
  }), [chatId]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A job that answered but made nothing (no notes / questions / cards): said in plain words, no retry needed. */
export class NothingMade extends Error {
  /** Our own line for the toast (never a server message). */
  constructor(readonly line: string) { super(line); }
}
/** The usual error toast for a job: our own "nothing made" line, or the API error with a retry. */
export function jobErrorToast(e: unknown, toast: { error: (m: string) => unknown; apiError: (e: unknown, o?: { onRetry?: () => void }) => unknown }, retry: () => void) {
  if (e instanceof NothingMade) toast.error(e.line);
  else toast.apiError(e, { onRetry: retry });
}

/** Tests: forget every job and live chat. */
export function resetBackgroundForTests() { jobs.clear(); chats.clear(); }
