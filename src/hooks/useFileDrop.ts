"use client";
// Files dropped anywhere on the page, or pasted with Ctrl+V (a file copied in File Explorer): one set of window
// listeners for the whole app, handed to the screen that asked last. A dialog that opens over a page (the course
// editor over Study) takes the files while it is open, and the page gets them back when it closes. A paste inside a
// text box is never taken: there Ctrl+V pastes text, as usual. With no screen asking, the browser behaves as normal.
import { useEffect, useRef, useState } from "react";

export type FileArrival = "drop" | "paste";
type Taker = { onFiles: (files: File[], how: FileArrival) => void; setDragging: (on: boolean) => void; priority: number; order: number };

const takers: Taker[] = [];
let installed = false;
let depth = 0;
let joined = 0;

/** The screen that gets the files: the highest priority, then the latest to ask. */
const top = (): Taker | undefined => takers.reduce<Taker | undefined>((best, t) =>
  !best || t.priority > best.priority || (t.priority === best.priority && t.order > best.order) ? t : best, undefined);
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

/** A text box, a select or anything editable: pasting there stays a normal paste. */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

function reset() {
  depth = 0;
  for (const t of takers) t.setDragging(false);
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("dragenter", (e) => {
    if (!top() || !hasFiles(e)) return;
    depth++;
    top()!.setDragging(true);
  });
  window.addEventListener("dragleave", (e) => {
    if (!top() || !hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) top()!.setDragging(false);
  });
  window.addEventListener("dragover", (e) => {
    if (!top() || !hasFiles(e)) return;
    e.preventDefault();                                   // without this the browser opens the file instead
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("drop", (e) => {
    if (!top() || !hasFiles(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    reset();
    if (files.length) top()!.onFiles(files, "drop");
  });
  window.addEventListener("dragend", reset);
  document.addEventListener("paste", (e) => {
    if (!top() || isEditable(e.target)) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    top()!.onFiles(files, "paste");
  });
}

/**
 * Take files dropped anywhere or pasted (outside text boxes) while `enabled`. The latest screen to ask gets them,
 * unless another asked with a higher `priority` (the chat's attachments: 1, over the Study page's uploads: 0; a
 * dialog: 2). `dragging`: files are being dragged over the page (show the drop overlay).
 */
export function useFileDrop(onFiles: (files: File[], how: FileArrival) => void, { enabled = true, priority = 0 }: { enabled?: boolean; priority?: number } = {}) {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onFiles);
  latest.current = onFiles;
  useEffect(() => {
    if (!enabled) return;
    install();
    const me: Taker = { onFiles: (f, how) => latest.current(f, how), setDragging, priority, order: ++joined };
    top()?.setDragging(false);
    takers.push(me);
    return () => {
      const i = takers.indexOf(me);
      if (i >= 0) takers.splice(i, 1);
      setDragging(false);
      depth = 0;
    };
  }, [enabled, priority]);
  return { dragging };
}

/** Tests: forget every screen that asked (the window listeners stay, harmlessly). */
export function resetFileDropForTests() {
  takers.length = 0;
  depth = 0;
}
