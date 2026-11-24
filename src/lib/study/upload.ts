// Uploading a PDF to the Worker (Stage 4.2). The browser does the reading: pdf.js takes each page's text here, so
// the Worker never parses PDFs (that would not fit its CPU limit). Then:
//   POST /upload (lib/api/index.ts uploadPDF)  ->  PUT /documents/{id}/file  ->  POST /documents/{id}/pages, in batches.
// Word, PowerPoint, Excel and text files (Files stage 2) are read here too (lib/study/convert.ts); only a PDF's file
// is stored, so for them the PUT is skipped and the pages go straight up.
// Scanned PDFs and photos (Files stage 4): pages with no text layer are listed in `ocr`; after the text pages, each is
// drawn to a JPEG here and sent alone to POST /documents/{id}/ocr, where a model that can see writes out its text.
import { loadPdfJs } from "@/lib/study/pdf";
import { API_BASE_URL } from "@/lib/api/client";
import { ApiError, parseApiError } from "@/lib/api/errors";
import type { DocumentInfo } from "@/lib/api";
import { formatOf } from "./formats";
import { canvasJpeg, IMAGE_MAX_PX, shrinkImage } from "./images";

export const PAGES_PER_BATCH = 20;
export const NO_TEXT_MESSAGE =
  "No readable text was found in this PDF. It may be a scanned or image-only document: try a text-based PDF (or run OCR on it first).";
/** A page with fewer letters than this has no real text layer. */
const SCANNED_PAGE_CHARS = 20;

export interface ReadPdf {
  pageCount: number;
  pages: { page: number; text: string }[];
  /** SHA-256 of the file, hex. */
  hash: string;
  textChars: number;
  /** Pages with no text layer, for the AI to read from a picture of the page (a scan, a photo). */
  ocr?: number[];
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Each page's text, in reading order. A scanned PDF (most pages without a text layer) lists those pages in `ocr`, to
 * be read by the AI; a normal PDF's few blank pages are just blank (no AI reading spent on them).
 */
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
  const bare = pages.filter((p) => p.text.replace(/\s+/g, "").length < SCANNED_PAGE_CHARS).map((p) => p.page);
  if (bare.length * 2 > pages.length) return { pageCount: pages.length, pages, hash, textChars, ocr: bare };
  if (textChars < 20) {
    throw new ApiError(400, { code: "no_text", message: NO_TEXT_MESSAGE, action: "reupload", details: null });
  }
  return { pageCount: pages.length, pages, hash, textChars };
}

/** Any file a course can hold, as pages of text with its fingerprint (a PDF through pdf.js, the rest in convert.ts). */
export async function readDocument(file: File): Promise<ReadPdf> {
  if (formatOf(file.name) === "pdf" || (!formatOf(file.name) && file.type === "application/pdf")) return readPdf(file);
  const buf = await file.arrayBuffer();
  const hash = await sha256Hex(buf);
  if (formatOf(file.name) === "image") return { pageCount: 1, pages: [{ page: 1, text: "" }], hash, textChars: 0, ocr: [1] };
  const { readOtherDocument } = await import("./convert");          // loaded only when such a file is added
  return { ...(await readOtherDocument(file, buf)), hash };
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

/** Busy or offline (worth another try), as opposed to a refusal (a plan limit, a bad file). */
const transient = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 503 || (e.status === 429 && e.code === "rate_limited"));

async function withRetries<T>(send: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries++) {
    try {
      return await send();
    } catch (e) {
      if (tries >= 3 || !transient(e)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * tries));
    }
  }
}

/** A page of a PDF drawn as a JPEG at most IMAGE_MAX_PX on its long side (for the AI to read). */
async function pdfPageImage(pdf: { getPage: (n: number) => Promise<any> }, n: number): Promise<{ mime: string; data: string }> {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, IMAGE_MAX_PX / Math.max(base.width, base.height)) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  const { mime, data } = canvasJpeg(canvas);
  return { mime, data };
}

/** Tests replace how a page becomes a picture (jsdom has no canvas). */
let pageImageForTests: ((file: File, page: number) => Promise<{ mime: string; data: string }>) | null = null;
export function setPageImageForTests(f: typeof pageImageForTests) { pageImageForTests = f; }

/** After POST /upload: the file (PDFs), the text pages in batches, then each page for the AI to read (scans, photos). */
export async function sendUpload(
  documentId: string, file: File, read: ReadPdf, onDocument: (doc: DocumentInfo) => void,
): Promise<DocumentInfo> {
  const id = encodeURIComponent(documentId);
  let doc: DocumentInfo | null = null;
  if (formatOf(file.name) === "pdf") {                                  // only a PDF's file is kept (for the viewer)
    doc = await call(`/documents/${id}/file`, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
    onDocument(doc);
  }
  const ocr = new Set(read.ocr ?? []);
  const textPages = read.pages.filter((p) => !ocr.has(p.page));
  for (let i = 0; i < textPages.length; i += PAGES_PER_BATCH) {
    const batch = textPages.slice(i, i + PAGES_PER_BATCH);
    const done = !ocr.size && i + PAGES_PER_BATCH >= textPages.length;
    doc = await withRetries(() => call(`/documents/${id}/pages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages: batch, done }),
    }));
    onDocument(doc);
  }
  if (ocr.size) {
    const order = [...ocr].sort((a, b) => a - b);
    type Pdf = { getPage: (n: number) => Promise<any>; destroy: () => Promise<void> };
    let pdf: Pdf | null = null as Pdf | null;
    try {
      for (const [i, page] of order.entries()) {
        let image: { mime: string; data: string };
        if (pageImageForTests) image = await pageImageForTests(file, page);
        else if (formatOf(file.name) === "image") image = await shrinkImage(file);
        else {
          if (!pdf) {
            const pdfjs = await loadPdfJs();
            pdf = (await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise) as unknown as Pdf;
          }
          image = await pdfPageImage(pdf!, page);
        }
        doc = await withRetries(() => call(`/documents/${id}/ocr`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page, ...image, done: i === order.length - 1 }),
        }));
        onDocument(doc);
      }
    } finally {
      if (pdf) void pdf.destroy().catch(() => {});
    }
  }
  return doc!;
}
