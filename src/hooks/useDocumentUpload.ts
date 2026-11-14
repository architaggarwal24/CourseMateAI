import { useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionStore } from "@/hooks/useSessions";
import { useCourses } from "@/hooks/useCourses";

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * Uploading a PDF for the active document: `documentId` replaces (or re-creates) that document, none lets the
 * server pick one. `courseId`: the PDF joins that course (Study works inside courses). The server answers at once
 * and keeps indexing; the store polls its status, which the Study header renders.
 */
export function useDocumentUpload(documentId: string | undefined, courseId?: string) {
  const { user } = useAuth();
  const uploadDocument = useSessionStore((s) => s.uploadDocument);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** New PDFs for a course can be picked several at once; a replacement is one file. */
  const multiple = !documentId && !!courseId;

  type Doc = Awaited<ReturnType<typeof uploadDocument>>;
  /** One file, no busy state: undefined when it was refused or failed (already said in a toast). */
  const send = useCallback(async (file: File, retry: () => void): Promise<Doc | undefined> => {
    if (file.type !== "application/pdf") { toast.error(`${file.name} isn't a PDF`); return undefined; }
    if (file.size > MAX_PDF_BYTES) { toast.error(`${file.name} is too large. Maximum size is 50MB`); return undefined; }
    try {
      const document = await uploadDocument(documentId, file, courseId);
      if (document.status === "ready") toast.success(`${document.filename} is ready to study`);   // same file as before: reused
      return document;
    } catch (error) {
      toast.apiError(error, { onRetry: retry });
      return undefined;
    }
  }, [documentId, courseId, uploadDocument]);

  const finish = useCallback(() => {
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (courseId) void useCourses.getState().load(true).catch(() => {});            // its PDF list changed
  }, [courseId]);

  const upload = useCallback(async (file: File): Promise<Doc | undefined> => {
    if (!user) { toast.error("Please login first to upload PDFs"); return undefined; }
    setUploading(true);
    try {
      return await send(file, () => void upload(file));
    } finally {
      finish();
    }
  }, [user, send, finish]);

  /**
   * Several PDFs at once (adding to a course): one after another, so the plan's limits stop it cleanly at the
   * first one that doesn't fit. Replacing a document takes only the first file.
   */
  const uploadMany = useCallback(async (files: File[]): Promise<Doc[]> => {
    if (!files.length) return [];
    if (!multiple || files.length === 1) { const d = await upload(files[0]); return d ? [d] : []; }
    if (!user) { toast.error("Please login first to upload PDFs"); return []; }
    const pdfs = files.filter((f) => f.type === "application/pdf");
    const skipped = files.length - pdfs.length;
    if (skipped) toast.error(`${skipped} of those files ${skipped === 1 ? "isn't a PDF" : "aren't PDFs"}, skipped`);
    if (!pdfs.length) return [];
    setUploading(true);
    const done: Doc[] = [];
    try {
      if (pdfs.length > 1) toast.info(`Adding ${pdfs.length} PDFs…`);
      for (const [i, file] of pdfs.entries()) {
        const doc = await send(file, () => void uploadMany(pdfs.slice(i)));
        if (!doc) break;                                // refused (a limit, a bad file): the rest would be too
        done.push(doc);
      }
      return done;
    } finally {
      finish();
    }
  }, [multiple, user, upload, send, finish]);

  const pick = useCallback(() => inputRef.current?.click(), []);

  return { inputRef, uploading, upload, uploadMany, multiple, pick, signedIn: !!user };
}

export type DocumentUpload = ReturnType<typeof useDocumentUpload>;
