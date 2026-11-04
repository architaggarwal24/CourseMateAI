// The side-by-side PDF viewer's helpers: lazy pdf.js, and finding a cited passage among a page's text items.
import { API_BASE_URL } from "@/lib/api/client";

export const documentFileUrl = (documentId: string) => `${API_BASE_URL}/documents/${encodeURIComponent(documentId)}/file`;

/** pdf.js, loaded only when the viewer first opens (the legacy build runs on older Safari too). */
export async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  return pdfjs;
}

const norm = (s: string) => s.toLowerCase().replace(/[­]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Which of a page's text items make up the cited passage. pdf.js splits a page into items (runs of text); their
 * joined text is searched (lower-case, punctuation and spacing ignored) for windows of six words slid along the
 * passage. The passage was cut from the PDF's text at chunk boundaries, so it may start on the previous page or
 * run onto the next: the highlight covers every window found here, from the first to the last.
 * Returns the indexes of the items that overlap it (empty: not on this page).
 */
export function passageItems(items: { str: string }[], passage: string): number[] {
  const pieces: { start: number; end: number; index: number }[] = [];
  let text = "";
  items.forEach((it, index) => {
    const t = norm(it.str);
    if (!t) return;
    if (text) text += " ";
    pieces.push({ start: text.length, end: text.length + t.length, index });
    text += t;
  });
  const words = norm(passage).split(" ").filter(Boolean);
  if (!words.length || !text) return [];
  let from = -1, to = -1;
  for (const want of WINDOWS) {                      // six-word windows; four-word ones if none of those is here
    const size = Math.min(want, words.length);
    const starts: number[] = [];
    for (let i = 0; i + size <= words.length; i += Math.max(1, Math.floor(size / 2))) starts.push(i);
    if (starts[starts.length - 1] !== words.length - size) starts.push(words.length - size);   // and the tail
    for (const i of starts) {
      const probe = words.slice(i, i + size).join(" ");
      if (probe.length < 18 && words.length > size) continue;        // too short to mean anything
      const at = text.indexOf(probe);
      if (at < 0) continue;
      if (from < 0 || at < from) from = at;
      to = Math.max(to, at + probe.length);
    }
    if (from >= 0) break;
  }
  if (from < 0) return [];
  return pieces.filter((x) => x.end > from && x.start < to).map((x) => x.index);
}

const WINDOWS = [6, 4];
