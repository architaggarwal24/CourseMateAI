"use client";
// Undo instead of "Are you sure?" (Gmail): the change shows at once, an Undo toast stays for UNDO_MS, and only then
// is the request sent. Undo puts it back and nothing is sent. Leaving or hiding the page sends whatever is pending
// (so nothing is lost), and a change the server refuses is put back with the error.
import Button from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";

export const UNDO_MS = 8000;

interface Pending { run: () => void }
const pending = new Set<Pending>();

export interface UndoableOptions {
  /** What the toast says, e.g. "biology.pdf deleted". */
  message: string;
  /** Send the change (after the undo window). */
  commit: () => Promise<unknown>;
  /** Put it back on screen (Undo, or the change failed). */
  undo: () => void;
  /** The change failed (it has already been put back). Default: the usual error toast. */
  onError?: (e: unknown) => void;
}

export function undoable({ message, commit, undo, onError }: UndoableOptions): void {
  let toastId = 0;
  const entry: Pending = {
    run: () => {
      pending.delete(entry);
      clearTimeout(timer);
      toast.dismiss(toastId);
      void commit().catch((e) => {
        undo();
        if (onError) onError(e); else toast.apiError(e);
      });
    },
  };
  const timer = setTimeout(entry.run, UNDO_MS);
  pending.add(entry);
  toastId = toast.success(message, {
    duration: UNDO_MS,
    action: (
      <Button size="sm" variant="secondary" onClick={() => {
        if (!pending.delete(entry)) return;                            // already sent
        clearTimeout(timer);
        toast.dismiss(toastId);
        undo();
      }}>Undo</Button>
    ),
  });
  ensureFlushOnLeave();
}

/** Send every change still waiting for its undo window (the page is going away). */
export function flushUndoables(): void {
  for (const entry of [...pending]) entry.run();
}

let listening = false;
function ensureFlushOnLeave() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("pagehide", flushUndoables);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushUndoables(); });
}
