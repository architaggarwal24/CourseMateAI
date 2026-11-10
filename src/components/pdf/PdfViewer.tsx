"use client";

import { usePlanChanged } from "@/hooks/usePlanChanged";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileWarning, Lock, X } from "@/components/icons";
import { Button, Skeleton } from "@/components/ui";
import { citationText, type Citation } from "@/lib/study/citations";
import { documentFileUrl, loadPdfJs, passageItems } from "@/lib/study/pdf";
import "./pdf.css";

type Status = "loading" | "ready" | "unavailable" | "locked" | "error";
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any> };

// One download per document per page view: opening another citation of the same PDF reuses it.
const docs = new Map<string, Promise<PdfDoc>>();

class FileError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function openDocument(docId: string): Promise<PdfDoc> {
  let p = docs.get(docId);
  if (!p) {
    p = (async () => {
      const res = await fetch(documentFileUrl(docId), { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new FileError(res.status, String(body?.error?.code ?? res.status));
      }
      const pdfjs = await loadPdfJs();
      return (await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise) as unknown as PdfDoc;
    })();
    docs.set(docId, p);
    p.catch(() => docs.delete(docId));
  }
  return p;
}

/** For tests: forget the documents opened so far. */
export function resetPdfCache() { docs.clear(); }

/**
 * The cited page of the PDF, beside the chat: pdf.js draws the page, the cited passage is highlighted on it (its
 * text is found among the page's text runs), and the passage itself is also shown in words below the page - for
 * screen readers, and for when the exact lines can't be found. Esc closes; ← → (buttons) turn pages.
 */
export default function PdfViewer({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const [status, setStatus] = useState<Status>("loading");
  const [page, setPage] = useState(citation.page ?? 1);
  const [pages, setPages] = useState(0);
  const [found, setFound] = useState<boolean | null>(null);
  const [boxes, setBoxes] = useState<{ left: number; top: number; width: number; height: number }[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const docRef = useRef<PdfDoc | null>(null);

  useEffect(() => { setPage(citation.page ?? 1); }, [citation]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [citation]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // open the document (again, if the plan just went up while it said "locked")
  const [tries, setTries] = useState(0);
  usePlanChanged(() => setTries((n) => n + 1), status === "locked");
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    if (!citation.doc_id) { setStatus("unavailable"); return; }
    openDocument(citation.doc_id).then((d) => {
      if (!alive) return;
      docRef.current = d;
      setPages(d.numPages);
      setStatus("ready");
    }).catch((e) => {
      if (!alive) return;
      setStatus(e instanceof FileError && e.code === "feature_locked" ? "locked"
        : e instanceof FileError && (e.status === 404) ? "unavailable" : "error");
    });
    return () => { alive = false; };
  }, [citation.doc_id, tries]);

  // draw the page and find the passage on it
  useEffect(() => {
    if (status !== "ready" || !docRef.current || !canvas.current || !frame.current) return;
    let alive = true;
    let task: { cancel?: () => void; promise?: Promise<unknown> } | null = null;
    (async () => {
      const pdf = docRef.current!;
      const p = await pdf.getPage(Math.min(Math.max(1, page), pdf.numPages));
      if (!alive) return;
      const width = Math.max(240, frame.current!.clientWidth);
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: width / base.width });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const c = canvas.current!;
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      task = p.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await task!.promise;
      if (!alive) return;
      if (page !== citation.page) { setBoxes([]); setFound(null); return; }
      const text = await p.getTextContent();
      const items = text.items.filter((it: any) => typeof it.str === "string");
      const hit = passageItems(items, citation.text);
      const pdfjs = await loadPdfJs();
      const rects = hit.map((i) => {
        const it: any = items[i];
        const tx = pdfjs.Util.transform(viewport.transform, it.transform);
        const h = Math.hypot(tx[2], tx[3]);
        return { left: tx[4], top: tx[5] - h, width: it.width * viewport.scale, height: h * 1.15 };
      });
      if (!alive) return;
      setBoxes(rects);
      setFound(rects.length > 0);
      if (rects.length) {
        frame.current?.querySelector(".pdf-mark")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      }
    })().catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; task?.cancel?.(); };
  }, [status, page, citation]);

  const title = citation.doc_name ?? "Document";
  return (
    <aside className="pdf-panel" data-side="" aria-labelledby="pdf-panel-title">
      <header className="pdf-panel__head">
        <div className="min-w-0">
          <h3 id="pdf-panel-title" ref={heading} tabIndex={-1} style={{ outline: "none" }} className="pdf-panel__title" title={title}>{title}</h3>
          <p className="pdf-panel__sub">Source [{citation.n}]{citation.page ? ` · cited on page ${citation.page}` : ""}</p>
        </div>
        <Button size="sm" icon variant="ghost" onClick={onClose} aria-label="Close the PDF (Esc)" title="Close (Esc)"><X size={16} /></Button>
      </header>

      {status === "ready" && (
        <div className="pdf-panel__nav">
          <Button size="sm" icon onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={16} /></Button>
          <span className="pdf-panel__page" aria-live="polite">Page {page} of {pages}</span>
          <Button size="sm" icon onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Next page"><ChevronRight size={16} /></Button>
          {citation.page && page !== citation.page && (
            <Button size="sm" variant="ghost" onClick={() => setPage(citation.page!)}>Back to page {citation.page}</Button>
          )}
        </div>
      )}

      <div className="pdf-panel__body" tabIndex={0} role="region" aria-label={`Page ${page} of ${title}`}>
        {status === "loading" && <Skeleton className="h-[420px] w-full rounded-[var(--radius-lg)]" aria-label="Loading the PDF" />}
        {status === "unavailable" && (
          <div className="pdf-panel__notice"><FileWarning size={18} aria-hidden="true" />
            <p>This PDF's pages aren't stored (it was uploaded before page viewing existed). Upload the same file again to open them.</p></div>
        )}
        {status === "locked" && (
          <div className="pdf-panel__notice"><Lock size={18} aria-hidden="true" />
            <p>Opening the PDF at the cited page comes with the Sage plan. The cited passage is below.</p></div>
        )}
        {status === "error" && (
          <div className="pdf-panel__notice"><FileWarning size={18} aria-hidden="true" /><p>The PDF couldn't be opened. The cited passage is below.</p></div>
        )}
        <div ref={frame} className="pdf-panel__frame" hidden={status !== "ready"}>
          <div className="pdf-panel__page-wrap">
            <canvas ref={canvas} aria-hidden="true" />
            {boxes.map((b, i) => <span key={i} className="pdf-mark" aria-hidden="true" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />)}
          </div>
        </div>
        <figure className="pdf-panel__quote">
          <figcaption>{found === false ? `The exact lines weren't found on page ${citation.page}. The cited passage:` : "Cited passage"}</figcaption>
          <blockquote>{citation.text}</blockquote>
          <p className="sr-only">From {citationText(citation)}.</p>
        </figure>
      </div>
    </aside>
  );
}
