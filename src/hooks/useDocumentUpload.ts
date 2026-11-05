import { useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionStore } from "@/hooks/useSessions";

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * Uploading a PDF for the active document: `documentId` replaces (or re-creates) that document, none lets the
 * server pick one. The server answers at once and keeps indexing; the store polls its status, which the Study
 * header renders.
 */
export function useDocumentUpload(documentId: string | undefined) {
  const { user } = useAuth();
  const uploadDocument = useSessionStore((s) => s.uploadDocument);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    if (!user) { toast.error("Please login first to upload PDFs"); return; }
    if (file.type !== "application/pdf") { toast.error("Please upload a PDF file"); return; }
    if (file.size > MAX_PDF_BYTES) { toast.error("File too large. Maximum size is 50MB"); return; }

    setUploading(true);
    try {
      const document = await uploadDocument(documentId, file);
      if (document.status === "ready") toast.success(`✅ ${document.filename} ready!`);   // same file as before: reused
    } catch (error) {
      toast.apiError(error, { onRetry: () => upload(file) });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [documentId, user, uploadDocument]);

  const pick = useCallback(() => inputRef.current?.click(), []);

  return { inputRef, uploading, upload, pick, signedIn: !!user };
}

export type DocumentUpload = ReturnType<typeof useDocumentUpload>;
