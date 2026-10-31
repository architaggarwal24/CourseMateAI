"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Upload, FileText, CheckCircle, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { Button } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useDocument, useSessionStore } from "@/hooks/useSessions";
import { describeDocument, isInFlight, STAGES, stageIndex, stageLabel } from "@/lib/documents";
import type { DocumentStatus } from "@/lib/api";

interface FileUploaderProps {
  sessionId: string;
}

/**
 * The Arena's uploader: a PDF for the arena's own session (the Study workspace uses shell/DocumentHeader instead).
 * Upload a PDF into this session and follow it through the server's stages (queued → reading →
 * indexing → ready). What is shown always comes from the server's record of the document, so it
 * survives reloads and server restarts and notices when the server has dropped the document.
 */
export default function FileUploader({ sessionId }: FileUploaderProps) {
  const { user } = useAuth();
  const { document: doc, loaded } = useDocument(sessionId);
  const uploadDocument = useSessionStore((s) => s.uploadDocument);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPageDragging, setIsPageDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Announce the outcome of a document we watched being processed (not one that was already finished on load).
  const previousStatus = useRef<DocumentStatus | undefined>(undefined);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = doc?.status;
    if (!doc || !previous || !isInFlight(previous)) return;
    if (doc.status === "ready") toast.success(`✅ ${doc.filename} ready!`);
    else if (doc.status === "failed") toast.error(doc.error || `${doc.filename} could not be processed`);
  }, [doc?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = useCallback(async (file: File) => {
    if (!user) { toast.error("Please login first to upload PDFs"); return; }
    if (file.type !== "application/pdf") { toast.error("Please upload a PDF file"); return; }
    if (file.size > 50 * 1024 * 1024) { toast.error("File too large. Maximum size is 50MB"); return; }

    setUploading(true);
    setIsPageDragging(false);
    try {
      // The server answers as soon as the file is registered; indexing continues there and the store
      // polls its status, which this component renders.
      const document = await uploadDocument(sessionId, file);
      if (document.status === "ready") toast.success(`✅ ${document.filename} ready!`);   // same file as before: reused
    } catch (error) {
      toast.apiError(error, { onRetry: () => handleUpload(file) });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [sessionId, user, uploadDocument]);

  // ── Global window drag-and-drop ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
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
      const file = e.dataTransfer?.files?.[0];
      if (file) handleUpload(file);
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
  }, [user, handleUpload]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleLocalDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const pickAnotherFile = () => inputRef.current?.click();

  return (
    <>
      {/* Drag overlay — rendered via portal at body root for true full-screen coverage */}
      {isPageDragging && typeof document !== "undefined" && createPortal(
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 2147483647, // max z-index
          background: "color-mix(in srgb, var(--color-surface) 94%, transparent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "3px dashed var(--color-accent-text)",
          margin: 0,
          pointerEvents: "none",
        }}>
          <div style={{ textAlign: "center", color: "var(--color-text)", pointerEvents: "none" }}>
            <FileText size={56} aria-hidden="true" style={{ margin: "0 auto 16px", color: "var(--color-accent-text)" }} />
            <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Drop your PDF anywhere</div>
            <div style={{ fontSize: 14, color: "var(--color-muted)" }}>Release to upload immediately</div>
          </div>
        </div>,
        document.body
      )}

      <div className="relative">
        <input
          ref={inputRef} type="file" accept=".pdf"
          onChange={handleFileChange}
          disabled={uploading || !user || !loaded}
          className="hidden"
          id={`pdf-upload-${sessionId}`}
        />
        {doc ? (
          <DocumentChip
            filename={doc.filename}
            status={doc.status}
            message={describeDocument(doc)}
            onPickFile={uploading ? undefined : pickAnotherFile}
          />
        ) : (
          <label
            htmlFor={`pdf-upload-${sessionId}`}
            onDrop={handleLocalDrop}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            aria-disabled={!user || uploading || !loaded || undefined}
            className={`ui-btn ui-btn--secondary select-none ${
              !user ? "opacity-50 cursor-not-allowed"
              : uploading || !loaded ? "opacity-70 cursor-wait"
              : isDragging ? "border-ink-blue text-ink-blue"
              : "cursor-pointer"
            }`}
            title={!user ? "Login to upload" : "Click or drag a PDF anywhere on page"}
          >
            <Upload size={16} aria-hidden="true" className={uploading ? "animate-pulse" : ""} />
            <span>{!user ? "Login to Upload" : uploading ? "Uploading..." : !loaded ? "Checking..." : isDragging ? "Drop PDF here" : "Upload PDF"}</span>
          </label>
        )}
      </div>
    </>
  );
}

/** The document as the server reports it: a stage tracker while it is processed, then ready / failed / stale. */
function DocumentChip({ filename, status, message, onPickFile }: {
  filename: string; status: DocumentStatus; message: string; onPickFile?: () => void;
}) {
  const step = stageIndex(status);
  const label = stageLabel(status);

  if (isInFlight(status)) {
    return (
      <div className="flex flex-col gap-1.5 px-3 py-2 rounded-lg bg-panel border border-line text-fg text-sm min-w-[190px]"
           role="status" aria-live="polite" aria-label={message}>
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="shrink-0 animate-spin text-ink-blue" aria-hidden="true" />
          <span className="max-w-[120px] truncate text-xs font-medium" title={filename}>{filename}</span>
          <span className="ml-auto text-xs font-medium whitespace-nowrap text-fg-2">{label}…</span>
        </div>
        <div className="flex gap-1" aria-hidden="true">
          {STAGES.map((stage, i) => (
            <div
              key={stage.status}
              title={stage.label}
              className={`h-1 flex-1 rounded-full ${i < step ? "bg-accent-blue" : i === step ? "bg-accent-blue animate-pulse" : "bg-line"}`}
            />
          ))}
        </div>
      </div>
    );
  }

  if (status === "failed" || status === "needs_reindex") {
    const failed = status === "failed";
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border bg-panel text-sm max-w-[320px] text-fg ${
        failed ? "border-ink-red" : "border-[var(--color-warning-text)]"}`}
           role="alert">
        <AlertCircle size={15} aria-hidden="true" className={`shrink-0 ${failed ? "text-ink-red" : "text-[var(--color-warning-text)]"}`} />
        <span className="text-xs min-w-0">
          <span className="block font-medium truncate" title={filename}>{filename} — {label.toLowerCase()}</span>
          <span className="block text-fg-2 line-clamp-2" title={message}>{message}</span>
        </span>
        {onPickFile && (
          <Button size="sm" onClick={onPickFile} className="ml-1 shrink-0">{failed ? "Try again" : "Re-upload"}</Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-panel border border-line text-fg text-sm">
      <CheckCircle size={15} className="shrink-0 text-ink-green" aria-hidden="true" />
      <FileText size={14} className="shrink-0 text-fg-muted" aria-hidden="true" />
      <span className="max-w-[140px] truncate text-xs font-medium" title={filename}>{filename}</span>
      {onPickFile && (
        <Button size="sm" variant="ghost" icon onClick={onPickFile} title="Replace PDF" aria-label="Replace PDF"><RefreshCw size={13} /></Button>
      )}
    </div>
  );
}
