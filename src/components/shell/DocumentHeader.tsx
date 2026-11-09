"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookMarked, FileText, FileUp, Pencil, Trash2, Upload } from "@/components/icons";
import { Badge, Button, toast, type BadgeTone } from "@/components/ui";
import type { DocumentUpload } from "@/hooks/useDocumentUpload";
import type { DocumentInfo, DocumentStatus } from "@/lib/api";
import type { Course } from "@/lib/study/courses";
import { describeDocument, isInFlight, STAGES, stageIndex, stageLabel } from "@/lib/documents";

/** What the badge says (three words at most) and how it looks. "expired" is the server no longer having the document. */
export type DocumentBadge = DocumentStatus | "expired";

const BADGES: Record<DocumentBadge, { label: string; tone: BadgeTone }> = {
  queued: { label: "Indexing", tone: "accent" },
  reading: { label: "Indexing", tone: "accent" },
  indexing: { label: "Indexing", tone: "accent" },
  ready: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  needs_reindex: { label: "Re-index", tone: "warning" },
  expired: { label: "Expired", tone: "warning" },
};

export function badgeFor(status: DocumentBadge) {
  return BADGES[status];
}

interface Props {
  doc: DocumentInfo | null;
  /** The server no longer has the document the page is about (it expired or was removed). */
  gone: boolean;
  /** False until the server has answered the document list: nothing is offered before then. */
  loaded: boolean;
  upload: DocumentUpload;
  /** The tool tabs, shown in the middle of the bar. */
  tabs?: ReactNode;
  /** The workspace is on a course (several PDFs): shown instead of a document, with Edit instead of Replace. */
  course?: Course | null;
  onEditCourse?: () => void;
  /** Wraps the name in the document / course switcher (LibraryMenu). */
  switcher?: (name: ReactNode) => ReactNode;
  /** Asks to delete the open PDF (the workspace confirms first). */
  onDelete?: () => void;
  /** The open PDF's course (a link back to its page). */
  inCourse?: { name: string; href: string };
  /** No course yet: the header only says so (the workspace shows how to make one). */
  noCourse?: boolean;
}

/**
 * The persistent header of the Study workspace: the active document as the server describes it (name, chunk
 * count, status badge) with Replace, or the way to upload one. Everything shown comes from the server's record,
 * so it survives reloads and backend restarts.
 */
export default function DocumentHeader({ doc, gone, loaded, upload, tabs, course, onEditCourse, switcher, onDelete, inCourse, noCourse }: Props) {
  const { inputRef, uploading, uploadMany, multiple, pick, signedIn } = upload;
  const [isPageDragging, setIsPageDragging] = useState(false);

  // Announce the outcome of a document we watched being processed (not one that was already finished on load).
  const previousStatus = useRef<DocumentStatus | undefined>(undefined);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = doc?.status;
    if (!doc || !previous || !isInFlight(previous)) return;
    if (doc.status === "ready") toast.success(`✅ ${doc.filename} ready!`);
    else if (doc.status === "failed") toast.error(doc.error || `${doc.filename} could not be processed`);
  }, [doc?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dropping a PDF anywhere on the page uploads it.
  useEffect(() => {
    if (!signedIn) return;
    const counter = { n: 0 };
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      counter.n++;
      setIsPageDragging(true);
    };
    const onLeave = () => {
      counter.n--;
      if (counter.n <= 0) { counter.n = 0; setIsPageDragging(false); }
    };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      counter.n = 0;
      setIsPageDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void uploadMany(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [signedIn, uploadMany]);

  const busy = uploading || !signedIn || !loaded;
  const named = (name: ReactNode) => (switcher ? switcher(name) : name);
  const badge = badgeFor(doc ? doc.status : "expired");
  const inFlight = !!doc && isInFlight(doc.status);
  const step = doc ? stageIndex(doc.status) : -1;
  const problem = !course && doc && (doc.status === "failed" || doc.status === "needs_reindex") ? describeDocument(doc) : null;

  return (
    <header aria-label="Active document" className="ws-top">
      {/* Drag overlay: a portal at the body root so it covers the whole screen */}
      {isPageDragging && typeof document !== "undefined" && createPortal(
        <div role="presentation" className="drop-overlay">
          <div className="drop-overlay__card">
            <FileUp size={40} className="drop-overlay__icon" aria-hidden="true" />
            <div className="text-xl font-semibold">{multiple ? "Drop your PDFs anywhere" : "Drop your PDF anywhere"}</div>
            <div className="text-sm text-fg-muted">Release to upload</div>
          </div>
        </div>,
        document.body,
      )}

      <input
        ref={inputRef} type="file" accept=".pdf" className="hidden" aria-label={multiple ? "Choose PDFs" : "Choose a PDF"}
        multiple={multiple} disabled={busy}
        onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) void uploadMany(files); }}
      />

      <div className="ws-doc">
        <span className="ws-doc__icon" aria-hidden="true">{course ? <BookMarked size={17} /> : <FileText size={17} />}</span>
        <div className="min-w-0">
          {noCourse ? (
            <>
              <span className="ws-doc__name">No course yet</span>
              <span className="ws-doc__meta">Make one to start studying</span>
            </>
          ) : course ? (
            <>
              {named(<span className="ws-doc__name" title={course.name}>{course.name}</span>)}
              <span className="ws-doc__meta">
                <Badge tone="accent">Course</Badge>
                <span className="whitespace-nowrap">
                  {course.documents.length} {course.documents.length === 1 ? "PDF" : "PDFs"}
                  {course.ready < course.documents.length ? ` · ${course.ready} ready` : ""}
                </span>
              </span>
            </>
          ) : doc ? (
            <>
              {named(<span className="ws-doc__name" title={doc.filename}>{doc.filename}</span>)}
              <span className="ws-doc__meta">
                {inCourse && <a href={inCourse.href} className="ws-doc__crumb" title={`In the course ${inCourse.name}`}><BookMarked size={12} aria-hidden="true" />{inCourse.name}</a>}
                <Badge tone={badge.tone} aria-label={`Status: ${stageLabel(doc.status)}`}>{badge.label}</Badge>
                {doc.status === "ready" && doc.chunks != null && (
                  <span className="whitespace-nowrap">{doc.chunks} {doc.chunks === 1 ? "chunk" : "chunks"}</span>
                )}
                {inFlight && (
                  <span className="inline-flex items-center gap-2" role="status" aria-live="polite" aria-label={describeDocument(doc)}>
                    <span className="whitespace-nowrap">{stageLabel(doc.status)}…</span>
                    <span className="ws-doc__stages" aria-hidden="true">
                      {STAGES.map((stage, i) => (
                        <span key={stage.status} title={stage.label} className="ws-doc__stage"
                              data-state={i < step ? "done" : i === step ? "now" : undefined} />
                      ))}
                    </span>
                  </span>
                )}
              </span>
            </>
          ) : gone ? (
            <>
              <span className="ws-doc__name">Document unavailable</span>
              <span className="ws-doc__meta"><Badge tone={badge.tone}>{badge.label}</Badge></span>
            </>
          ) : (
            <>
              {loaded && signedIn
                ? named(<span className="ws-doc__name">No document yet</span>)
                : <span className="ws-doc__name">{!signedIn ? "Log in to upload a PDF" : "Checking your documents…"}</span>}
              <span className="ws-doc__meta">Drop a PDF anywhere on the page</span>
            </>
          )}
        </div>
      </div>

      {tabs && <div className="ws-top__tabs">{tabs}</div>}

      {!gone && !noCourse && (
        <div className="ws-top__end">
          {course ? (
            <>
              {/* on a phone just the icons, so the course's name keeps its room */}
              <Button size="sm" variant="primary" onClick={pick} disabled={busy} loading={uploading} aria-label="Add PDFs" title="Add PDFs" className="max-sm:min-w-11">
                {!uploading && <Upload size={14} aria-hidden="true" />}<span className="max-sm:hidden">Add PDFs</span>
              </Button>
              <Button size="sm" onClick={onEditCourse} aria-label="Edit course" title="Edit course" className="max-sm:min-w-11">
                <Pencil size={14} aria-hidden="true" /><span className="max-sm:hidden">Edit course</span>
              </Button>
            </>
          ) : doc ? (
            <>
              <Button size="sm" onClick={pick} disabled={busy} loading={uploading} aria-label="Replace PDF" title="Replace PDF">
                {!uploading && <Upload size={14} aria-hidden="true" />}
                {problem ? (doc.status === "failed" ? "Try again" : "Re-upload") : "Replace"}
              </Button>
              {onDelete && (
                <Button size="sm" variant="ghost" icon onClick={onDelete} disabled={busy} aria-label="Delete PDF" title="Delete PDF">
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              )}
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={pick} disabled={busy} loading={uploading}>
              {!uploading && <Upload size={14} aria-hidden="true" />}
              Upload PDF
            </Button>
          )}
        </div>
      )}

      {problem && (
        <p role="alert" className="basis-full order-5 text-xs text-fg-2 max-w-[72ch]">{problem}</p>
      )}
    </header>
  );
}
