// Uploading a PDF to the Worker (Stage 4.2). The browser does the reading: pdf.js takes each page's text here, so
// the Worker never parses PDFs (that would not fit its CPU limit). Then:
//   POST /upload (lib/api.ts uploadPDF)  ->  PUT /documents/{id}/file  ->  POST /documents/{id}/pages, in batches.
import { loadPdfJs } from "@/lib/study/pdf";
import { API_BASE_URL } from "@/lib/api/client";
import { ApiError, parseApiError } from "@/lib/api/errors";
import type { DocumentInfo } from "@/lib/api";

export const PAGES_PER_BATCH = 20;
export const NO_TEXT_MESSAGE =
  "No readable text was found in this PDF. It may be a scanned or image-only document: try a text-based PDF (or run OCR on it first).";

export interface ReadPdf {
  pageCount: number;
  pages: { page: number; text: string }[];
  /** SHA-256 of the file, hex. */
  hash: string;
  textChars: number;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Each page's text, in reading order. Throws ApiError "no_text" for a scan with no text layer. */
export async function readPdf(file: File): Promise<ReadPdf> {
  const buf = await file.arrayBuffer();
  const hash = await sha256Hex(buf);
  const pdfjs = await loadPdfJs();
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
  } catch {
    throw new ApiError(400, { code: "invalid_file", message: "That file doesn't look like a valid PDF.", action: "reupload", details: null });
  }
  const pages: ReadPdf["pages"] = [];
  let textChars = 0;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
        .join("").replace(/[ \t]+\n/g, "\n").trim();
      textChars += text.replace(/\s+/g, "").length;
      pages.push({ page: n, text });
      page.cleanup();
    }
  } finally {
    void pdf.destroy();
  }
  if (textChars < 20) {
    throw new ApiError(400, { code: "no_text", message: NO_TEXT_MESSAGE, action: "reupload", details: null });
  }
  return { pageCount: pages.length, pages, hash, textChars };
}

async function call(path: string, init: RequestInit): Promise<DocumentInfo> {
  let res: Response;
  try {
    res = await fetch(new Request(`${API_BASE_URL}${path}`, { credentials: "include", ...init }));
  } catch {
    throw new ApiError(0, { code: "network", message: "The upload was interrupted. Check your connection and try again.", action: "retry", details: null });
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw parseApiError(res.status, body, `Upload failed with status ${res.status}`);
  return body as DocumentInfo;
}

/** After POST /upload: the file, then the pages in batches (each answer is the document's new status). */
export async function sendUpload(
  documentId: string, file: File, read: ReadPdf, onDocument: (doc: DocumentInfo) => void,
): Promise<DocumentInfo> {
  const id = encodeURIComponent(documentId);
  let doc = await call(`/documents/${id}/file`, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
  onDocument(doc);
  for (let i = 0; i < read.pages.length; i += PAGES_PER_BATCH) {
    const batch = read.pages.slice(i, i + PAGES_PER_BATCH);
    const done = i + PAGES_PER_BATCH >= read.pages.length;
    let tries = 0;
    for (;;) {
      try {
        doc = await call(`/documents/${id}/pages`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages: batch, done }),
        });
        break;
      } catch (e) {
        if (++tries >= 3 || !(e instanceof ApiError) || (e.status !== 0 && e.status !== 503 && e.status !== 429)) throw e;
        await new Promise((r) => setTimeout(r, 1500 * tries));
      }
    }
    onDocument(doc);
  }
  return doc;
}
