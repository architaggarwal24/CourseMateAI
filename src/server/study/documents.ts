// Documents on the Worker (Stage 4.2). The browser reads the PDF itself (pdf.js: each page's text) and then:
//   1. POST /upload {filename, size, pages, file_hash, session_id?}    the row, with the plan's limits checked
//   2. PUT  /documents/{id}/file  (the PDF bytes)                      kept in R2 for the page viewer; hash checked
//   3. POST /documents/{id}/pages {pages: [{page, text}], done}        chunked, embedded, stored; `done` = ready
// Statuses as before: queued -> reading -> indexing -> ready | failed. An upload the browser never finished turns
// into "failed" after STALE_MINUTES, with a message to upload it again.
import * as log from "../log";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { CurrentUser, RequestContext } from "../context";
import { courseDocuments, courses, documentChunks, documents } from "../db/schema";
import { HttpError } from "../http";
import { limits, nowIso, planLimit, requireFeature, tierFor, type Tier } from "../account/plans";
import { chunkText } from "../search/chunker";
import { EMBEDDING_MODEL, vectorId, type SearchDeps } from "../search";
import { purgeExpired, purgeTrashFiles, trashDocument } from "./trash";
import { MAX_COURSE_DOCUMENTS, r2Key } from "./limits";

export { MAX_COURSE_DOCUMENTS, r2Key };

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_PAGES = 3000;
export const MAX_PAGES_PER_BATCH = 40;
export const MAX_PAGE_CHARS = 40_000;
export const STALE_MINUTES = 15;
export const NO_TEXT_MESSAGE =
  "No readable text was found in this PDF. It may be a scanned or image-only document: try a text-based PDF (or run OCR on it first).";
const STALE_MESSAGE = "The upload stopped before it finished. Upload the PDF again.";

export type DocumentRow = typeof documents.$inferSelect;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function notFound(): HttpError {
  return new HttpError(404, "document_not_found", "That document couldn't be found. It may have been deleted.", "reupload");
}

export function publicView(row: DocumentRow, pinned = false) {
  return {
    id: row.id, filename: row.filename, file_hash: row.fileHash, status: row.status, error: row.error,
    chunks: row.chunks, embedding_model: row.embeddingModel, created_at: row.createdAt, last_used_at: row.lastUsedAt,
    pdf_available: row.pdfStored, pinned, pages: row.pages, indexed_pages: row.indexedPages,
  };
}

const IN_FLIGHT = new Set(["queued", "reading", "indexing"]);

/** An upload left half-done (the tab closed) becomes failed, so it doesn't spin for ever. */
async function settleStale(ctx: RequestContext, row: DocumentRow, now = new Date()): Promise<DocumentRow> {
  if (!IN_FLIGHT.has(row.status)) return row;
  if (now.getTime() - new Date(row.updatedAt).getTime() < STALE_MINUTES * 60_000) return row;
  const next = { status: "failed" as const, error: STALE_MESSAGE, updatedAt: nowIso(now) };
  await ctx.db.update(documents).set(next).where(and(eq(documents.id, row.id), eq(documents.updatedAt, row.updatedAt)));
  return { ...row, ...next };
}

async function pinnedIds(ctx: RequestContext, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await ctx.db.selectDistinct({ id: courseDocuments.documentId }).from(courseDocuments)
    .where(inArray(courseDocuments.documentId, ids)).all();
  return new Set(rows.map((r) => r.id));
}

export async function ownedDocument(ctx: RequestContext, user: CurrentUser, id: string): Promise<DocumentRow> {
  const row = await ctx.db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row || row.userId !== user.id) throw notFound();               // someone else's looks like a missing one
  return settleStale(ctx, row);
}

export async function listDocuments(ctx: RequestContext, user: CurrentUser) {
  const rows = await ctx.db.select().from(documents).where(eq(documents.userId, user.id)).orderBy(desc(documents.lastUsedAt)).all();
  const settled = await Promise.all(rows.map((r) => settleStale(ctx, r)));
  const pinned = await pinnedIds(ctx, settled.map((r) => r.id));
  return settled.map((r) => publicView(r, pinned.has(r.id)));
}

/** A course seen through the documents API (what GET /documents/{id} answers for a course id). */
export function courseView(course: typeof courses.$inferSelect, members: DocumentRow[]) {
  const ready = members.filter((m) => m.status === "ready");
  const status = ready.length ? "ready" : members.some((m) => IN_FLIGHT.has(m.status)) ? "queued" : "failed";
  return {
    id: course.id, filename: course.name, file_hash: `course:${course.id}`, status,
    error: ready.length ? null : "This course has no ready documents yet.",
    chunks: ready.reduce((n, m) => n + m.chunks, 0), embedding_model: null, created_at: course.createdAt,
    last_used_at: course.updatedAt, kind: "course", documents: members.map((m) => m.id),
  };
}

export async function courseMembers(ctx: RequestContext, courseId: string): Promise<DocumentRow[]> {
  const rows = await ctx.db.select({ d: documents }).from(courseDocuments)
    .innerJoin(documents, eq(documents.id, courseDocuments.documentId))
    .where(eq(courseDocuments.courseId, courseId)).orderBy(courseDocuments.position, courseDocuments.addedAt).all();
  return rows.map((r) => r.d);
}

/** Put a document at the end of a course (no-op if it's already in it). */
export async function joinCourse(ctx: RequestContext, courseId: string, documentId: string, now = nowIso()) {
  const n = (await ctx.db.select({ n: count() }).from(courseDocuments).where(eq(courseDocuments.courseId, courseId)).get())?.n ?? 0;
  await ctx.db.insert(courseDocuments).values({ courseId, documentId, position: n, addedAt: now }).onConflictDoNothing();
  await ctx.db.update(courses).set({ updatedAt: now }).where(eq(courses.id, courseId));
}

/** GET /documents/{id}: a document the user owns, or a course of theirs seen as one document. */
export async function getDocumentOrCourse(ctx: RequestContext, user: CurrentUser, id: string) {
  const found = await resolveDocumentOrCourse(ctx, user, id);
  if (found.kind === "course") return courseView(found.course, found.members);
  return publicView(found.row, (await pinnedIds(ctx, [found.row.id])).has(found.row.id));
}

/**
 * An id the user owns, as a document (settled) or a course (with its documents): one round trip asks for both kinds
 * at once (a D1 batch) instead of a document miss followed by a course read.
 */
export async function resolveDocumentOrCourse(ctx: RequestContext, user: CurrentUser, id: string):
  Promise<{ kind: "document"; row: DocumentRow } | { kind: "course"; course: typeof courses.$inferSelect; members: DocumentRow[] }> {
  const [docRows, courseRows] = await ctx.db.batch([
    ctx.db.select().from(documents).where(eq(documents.id, id)).limit(1),
    ctx.db.select().from(courses).where(eq(courses.id, id)).limit(1),
  ]);
  const row = docRows[0];
  if (!row) {
    const course = courseRows[0];
    if (course && course.userId === user.id) {
      requireFeature(await tierFor(ctx.db, user), "courses");
      return { kind: "course", course, members: await courseMembers(ctx, course.id) };
    }
    throw notFound();
  }
  if (row.userId !== user.id) throw notFound();
  return { kind: "document", row: await settleStale(ctx, row) };
}

function cleanFilename(name: unknown): string {
  const base = String(name ?? "").replace(/[\\/]/g, " ").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200);
  return base || "document.pdf";
}

/** Everything a document has in Vectorize, R2 and D1 (chunks); the row stays unless `dropRow`. */
async function purge(ctx: RequestContext, deps: SearchDeps | null, row: DocumentRow, dropRow: boolean) {
  if (row.chunks > 0 && deps) await deps.vectors.deleteByIds(Array.from({ length: row.chunks }, (_, i) => vectorId(row.id, i)));
  if (dropRow) {
    if (row.pdfStored) await ctx.env.FILES.delete(r2Key(row.userId, row.id));
    await ctx.db.delete(documents).where(eq(documents.id, row.id));
  } else {
    await ctx.db.delete(documentChunks).where(eq(documentChunks.documentId, row.id));
  }
}

/** PDFs one course holds. */

export interface StartUpload { filename?: unknown; size?: unknown; pages?: unknown; file_hash?: unknown; session_id?: unknown; course_id?: unknown }

export async function startUpload(ctx: RequestContext, deps: SearchDeps | null, user: CurrentUser, body: StartUpload) {
  const filename = cleanFilename(body.filename);
  const size = Number(body.size);
  const pages = Number(body.pages);
  const hash = String(body.file_hash ?? "").toLowerCase();
  const sessionId = typeof body.session_id === "string" && body.session_id.trim() ? body.session_id.trim() : null;
  // Study works on courses (round 7): a PDF uploaded inside one joins it. Checked before anything is written.
  const courseId = typeof body.course_id === "string" && body.course_id.trim() ? body.course_id.trim() : null;
  if (courseId) {
    const c = await ctx.db.select({ userId: courses.userId }).from(courses).where(eq(courses.id, courseId)).get();
    if (!c || c.userId !== user.id) throw new HttpError(404, "course_not_found", "That course doesn't exist.");
    const n = (await ctx.db.select({ n: count() }).from(courseDocuments).where(eq(courseDocuments.courseId, courseId)).get())?.n ?? 0;
    const already = sessionId ? await ctx.db.select({ d: courseDocuments.documentId }).from(courseDocuments)
      .where(and(eq(courseDocuments.courseId, courseId), eq(courseDocuments.documentId, sessionId))).get() : undefined;
    if (!already && n >= MAX_COURSE_DOCUMENTS) throw new HttpError(400, "course_full", `A course holds at most ${MAX_COURSE_DOCUMENTS} PDFs. Start another course for more.`);
  }
  if (!/\.pdf$/i.test(filename)) throw new HttpError(400, "invalid_file", "Only PDF files are supported.", "reupload");
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, "invalid_file", "That file is empty.", "reupload");
  if (size > MAX_FILE_BYTES) throw new HttpError(400, "invalid_file", "That PDF is over 50 MB. Try a smaller file.", "reupload");
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) {
    throw new HttpError(400, "invalid_file", `That PDF has no pages, or more than ${MAX_PAGES}.`, "reupload");
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, "invalid_file", "The file's fingerprint is missing.", "reupload");

  const tier: Tier = await tierFor(ctx.db, user);
  const lim = limits(tier);
  let existing: DocumentRow | undefined;
  if (sessionId) {
    if (await ctx.db.select({ id: courses.id }).from(courses).where(eq(courses.id, sessionId)).get()) {
      throw new HttpError(400, "invalid_input", "That id belongs to a course: upload the PDF on its own, then add it to the course.");
    }
    existing = await ctx.db.select().from(documents).where(eq(documents.id, sessionId)).get();
    if (existing && existing.userId !== user.id) throw new HttpError(403, "forbidden", "That document belongs to another account.");
    // Security fix #15: a new document's id becomes part of its storage key (pdfs/<user>/<id>.pdf), so a new id from
    // the browser must be a plain UUID (as the app makes them); an existing document keeps the id it has.
    if (!existing && !UUID_RE.test(sessionId)) throw new HttpError(400, "invalid_input", "That document id isn't valid.", "reupload");
  }
  if (existing && existing.fileHash === hash && (existing.status === "ready" || IN_FLIGHT.has(existing.status))) {
    const settled = await settleStale(ctx, existing);
    if (settled.status !== "failed") {
      await ctx.db.update(documents).set({ lastUsedAt: nowIso() }).where(eq(documents.id, settled.id));
      const message = settled.status === "ready" ? `'${filename}' is already indexed and ready` : `'${filename}' is already being processed`;
      if (courseId) await joinCourse(ctx, courseId, settled.id);
      return { ok: true, message, session_id: settled.id, reused: true, document: publicView(settled), course_id: courseId };
    }
  }
  if (!existing) {
    const have = (await ctx.db.select({ n: count() }).from(documents).where(eq(documents.userId, user.id)).get())?.n ?? 0;
    if (have >= lim.documents) {
      throw planLimit(tier, "documents", have, lim.documents,
        `Your plan holds ${lim.documents} documents and you have ${have}. Delete one, or upgrade for more.`);
    }
  }
  if (size > lim.pdf_mb * 1024 * 1024) {
    throw planLimit(tier, "pdf_mb", Math.ceil(size / (1024 * 1024)), lim.pdf_mb,
      `Your plan takes PDFs up to ${lim.pdf_mb} MB. Try a smaller file, or upgrade for bigger ones.`);
  }

  const now = nowIso();
  const fields = {
    filename, fileHash: hash, sizeBytes: size, pages, status: "queued" as const, error: null, chunks: 0, indexedPages: 0,
    embeddingModel: EMBEDDING_MODEL, pdfStored: false, updatedAt: now, lastUsedAt: now,
  };
  let id: string;
  if (existing) {
    await purge(ctx, deps, existing, false);                // a new file under the same id: the old index goes
    if (existing.pdfStored) await ctx.env.FILES.delete(r2Key(existing.userId, existing.id));
    await ctx.db.update(documents).set(fields).where(eq(documents.id, existing.id));
    id = existing.id;
  } else {
    id = sessionId ?? crypto.randomUUID();
    await ctx.db.insert(documents).values({ id, userId: user.id, createdAt: now, ...fields });
    // Security fix #11: the count above can be passed by parallel uploads, so count again now that the row is in and
    // take it back if this one went over (two racing for the last slot may both be refused, never both kept).
    const after = (await ctx.db.select({ n: count() }).from(documents).where(eq(documents.userId, user.id)).get())?.n ?? 0;
    if (after > lim.documents) {
      await ctx.db.delete(documents).where(eq(documents.id, id));
      throw planLimit(tier, "documents", after - 1, lim.documents,
        `Your plan holds ${lim.documents} documents and you have ${after - 1}. Delete one, or upgrade for more.`);
    }
  }
  if (courseId) await joinCourse(ctx, courseId, id, now);
  const row = (await ctx.db.select().from(documents).where(eq(documents.id, id)).get())!;
  return { ok: true, message: `'${filename}' received - it is being processed`, session_id: id, reused: false, document: publicView(row), course_id: courseId };
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Store the PDF in R2 while hashing it; the hash must be the one the upload began with. */
async function storeAndHash(bucket: R2Bucket, key: string, body: ReadableStream<Uint8Array>, size: number): Promise<string> {
  const g = globalThis as unknown as {
    DigestStream?: new (alg: string) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> };
    FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array>;
  };
  const DigestStream = (crypto as unknown as { DigestStream?: typeof g.DigestStream }).DigestStream ?? g.DigestStream;
  if (DigestStream && g.FixedLengthStream) {                  // on Workers: stream it, never all in memory
    const digest = new DigestStream("SHA-256");
    const sized = new g.FixedLengthStream(size);
    const [toR2, toHash] = body.tee();
    const piping = toR2.pipeTo(sized.writable);
    const put = bucket.put(key, sized.readable as unknown as Parameters<R2Bucket["put"]>[1], { httpMetadata: { contentType: "application/pdf" } });
    await Promise.all([piping, put, toHash.pipeTo(digest)]);
    return hex(await digest.digest);
  }
  const buf = await new Response(body).arrayBuffer();
  if (buf.byteLength !== size) throw new HttpError(400, "invalid_file", "The upload was cut short. Please try again.", "retry");
  await bucket.put(key, buf, { httpMetadata: { contentType: "application/pdf" } });
  return hex(await crypto.subtle.digest("SHA-256", buf));
}

/** A real PDF names itself in its first kilobyte ("%PDF-"); anything else (a page, a script, a renamed file) isn't one. */
export async function looksLikePdf(bucket: R2Bucket, key: string): Promise<boolean> {
  const head = await bucket.get(key, { range: { offset: 0, length: 1024 } });
  if (!head) return false;
  return new TextDecoder("latin1").decode(await head.arrayBuffer()).includes("%PDF-");
}

export async function putFile(ctx: RequestContext, user: CurrentUser, id: string, req: Request) {
  const row = await ownedDocument(ctx, user, id);
  if (row.status !== "queued") throw new HttpError(409, "upload_state", "This document isn't waiting for its file. Upload it again.", "reupload");
  const length = Number(req.headers.get("content-length"));
  if (!req.body || (Number.isFinite(length) && length > 0 && length !== row.sizeBytes)) {
    throw new HttpError(400, "invalid_file", "The file isn't the size the upload began with.", "reupload");
  }
  const key = r2Key(user.id, id);
  let got: string;
  try {
    got = await storeAndHash(ctx.env.FILES, key, req.body, row.sizeBytes);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "invalid_file", "The upload was cut short. Please try again.", "retry");
  }
  if (got !== row.fileHash) {
    await ctx.env.FILES.delete(key);
    throw new HttpError(400, "invalid_file", "The file changed during the upload. Please try again.", "retry");
  }
  if (!(await looksLikePdf(ctx.env.FILES, key))) {
    await ctx.env.FILES.delete(key);
    throw new HttpError(400, "not_a_pdf", "That file isn't a PDF. Choose a .pdf file and try again.", "reupload");
  }
  const next = { status: "reading" as const, pdfStored: true, updatedAt: nowIso() };
  await ctx.db.update(documents).set(next).where(eq(documents.id, id));
  return publicView({ ...row, ...next });
}

export interface PageText { page: number; text: string }

export async function addPages(ctx: RequestContext, deps: SearchDeps, user: CurrentUser, id: string, body: { pages?: unknown; done?: unknown }) {
  const row = await ownedDocument(ctx, user, id);
  if (row.status !== "reading" && row.status !== "indexing") {
    throw new HttpError(409, "upload_state", row.status === "ready" ? "This document is already ready." : "This upload isn't in progress. Upload the PDF again.", "reupload");
  }
  const raw = Array.isArray(body.pages) ? body.pages : [];
  if (raw.length > MAX_PAGES_PER_BATCH) throw new HttpError(400, "invalid_input", `Send at most ${MAX_PAGES_PER_BATCH} pages at a time.`);
  const pages: PageText[] = raw.map((p: { page?: unknown; text?: unknown }) => ({ page: Number(p?.page), text: String(p?.text ?? "") }));
  for (const p of pages) {
    if (!Number.isInteger(p.page) || p.page < 1 || p.page > row.pages) throw new HttpError(400, "invalid_input", "A page number is out of range.");
    if (p.text.length > MAX_PAGE_CHARS) p.text = p.text.slice(0, MAX_PAGE_CHARS);
  }

  const pieces = pages.flatMap((p) => chunkText(p.text).map((text) => ({ page: p.page, text })));
  let chunks = row.chunks;
  if (pieces.length) {
    let vectors: number[][];
    try {
      vectors = await deps.embedder.embed(pieces.map((c) => c.text));
    } catch {
      throw new HttpError(503, "embedding_unavailable", "Couldn't index these pages just now. Please try again in a moment.", "retry");
    }
    const start = row.chunks;
    try {
      await deps.vectors.upsert(pieces.map((c, i) => ({
        id: vectorId(id, start + i), values: vectors[i], metadata: { doc: id, user: String(user.id), page: c.page },
      })));
    } catch (e) {
      // Under `npm run dev` this is usually "Binding VECTORS needs to be run remotely": Vectorize has no local
      // version, so wrangler.jsonc marks it `"remote": true` and dev needs `npx wrangler login` (docs/deploy-cloudflare.md).
      log.error("[coursemate] search index write failed", e);
      throw new HttpError(503, "search_unavailable", "Couldn't save this PDF to the search index just now. Please try again in a moment.", "retry");
    }
    const rows = pieces.map((c, i) => ({ documentId: id, idx: start + i, page: c.page, text: c.text }));
    for (let i = 0; i < rows.length; i += 25) {                 // D1 takes at most 100 bound values a statement
      await ctx.db.insert(documentChunks).values(rows.slice(i, i + 25)).onConflictDoNothing();
    }
    chunks = start + pieces.length;
  }
  const done = body.done === true;
  const status = done ? (chunks > 0 ? "ready" as const : "failed" as const) : "indexing" as const;
  const next = {
    chunks, indexedPages: row.indexedPages + pages.length, status, error: status === "failed" ? NO_TEXT_MESSAGE : null, updatedAt: nowIso(),
  };
  const updated = await ctx.db.update(documents).set(next)
    .where(and(eq(documents.id, id), eq(documents.chunks, row.chunks))).run();
  if ((updated.meta?.changes ?? 0) === 0) throw new HttpError(409, "upload_state", "Two uploads of this document crossed. Upload it again.", "reupload");
  return publicView({ ...row, ...next });
}

/** Into the Trash (study/trash.ts): restorable for 30 days; its file and search index wait there too. */
export async function deleteDocument(ctx: RequestContext, deps: SearchDeps | null, user: CurrentUser, id: string) {
  const row = await ownedDocument(ctx, user, id);
  await trashDocument(ctx, user, row);
  await purgeExpired(ctx, deps, user.id);
}

/** Every document of the user, gone (account deletion). */
export async function purgeUserFiles(ctx: RequestContext, deps: SearchDeps | null, userId: number) {
  const rows = await ctx.db.select().from(documents).where(eq(documents.userId, userId)).all();
  for (const r of rows) await purge(ctx, deps, r, true);
  await purgeTrashFiles(ctx, deps, userId);                       // and what waits in the Trash
}

/** The kept PDF for the page viewer (the PDF viewer is a Sage feature), with byte ranges for pdf.js. */
export async function pdfFile(ctx: RequestContext, user: CurrentUser, id: string, req: Request): Promise<Response> {
  requireFeature(await tierFor(ctx.db, user), "pdf_viewer");
  const row = await ownedDocument(ctx, user, id);
  if (!row.pdfStored) {
    throw new HttpError(404, "pdf_unavailable", "The original PDF isn't stored for this document. Upload it again to open its pages.", "reupload");
  }
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d+)-(\d*)$/);
  const obj = await ctx.env.FILES.get(r2Key(row.userId, row.id), m ? {
    range: m[2] ? { offset: Number(m[1]), length: Number(m[2]) - Number(m[1]) + 1 } : { offset: Number(m[1]) },
  } : undefined);
  if (!obj) throw new HttpError(404, "pdf_unavailable", "The original PDF isn't stored for this document. Upload it again to open its pages.", "reupload");
  const headers = new Headers({
    "content-type": "application/pdf", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff",
    "accept-ranges": "bytes", "content-disposition": `inline; filename="${row.filename.replace(/"/g, "")}"`,
  });
  if (m) {
    const start = Number(m[1]);
    const end = m[2] ? Math.min(Number(m[2]), row.sizeBytes - 1) : row.sizeBytes - 1;
    headers.set("content-range", `bytes ${start}-${end}/${row.sizeBytes}`);
    headers.set("content-length", String(end - start + 1));
    return new Response((obj as R2ObjectBody).body as unknown as ReadableStream, { status: 206, headers });
  }
  headers.set("content-length", String(row.sizeBytes));
  return new Response((obj as R2ObjectBody).body as unknown as ReadableStream, { status: 200, headers });
}

/** How many documents count against the plan (Account -> Plan & usage). */
export async function documentCount(ctx: RequestContext, userId: number): Promise<number> {
  return (await ctx.db.select({ n: count() }).from(documents).where(eq(documents.userId, userId)).get())?.n ?? 0;
}


/**
 * What a study tool works on for `id`: one ready document, or a course's ready documents (a Sage feature).
 * `hash` names the content (the document's file hash, or "course:<id>") for caches and mastery.
 */
export async function studyDocs(ctx: RequestContext, user: CurrentUser, id: string) {
  const row = await ctx.db.select().from(documents).where(eq(documents.id, id)).get();
  if (row) {
    if (row.userId !== user.id) throw notFound();
    const settled = await settleStale(ctx, row);
    if (settled.status !== "ready") {
      throw new HttpError(409, "document_not_ready", settled.status === "failed"
        ? (settled.error || "This document couldn't be processed. Upload it again.")
        : "This document is still being processed. Try again when it's ready.", settled.status === "failed" ? "reupload" : "retry");
    }
    await ctx.db.update(documents).set({ lastUsedAt: nowIso() }).where(eq(documents.id, id));
    return { kind: "document" as const, id, name: row.filename, hash: row.fileHash, docs: [{ id, name: row.filename }] };
  }
  const course = await ctx.db.select().from(courses).where(eq(courses.id, id)).get();
  if (!course || course.userId !== user.id) throw notFound();
  requireFeature(await tierFor(ctx.db, user), "courses");
  const members = await courseMembers(ctx, id);
  const ready = members.filter((m) => m.status === "ready");
  if (!ready.length) {
    const settled = await Promise.all(members.map((m) => settleStale(ctx, m)));
    const working = settled.some((m) => IN_FLIGHT.has(m.status));
    throw new HttpError(409, "course_empty", !members.length
      ? "This course has no PDFs yet. Add one to start."
      : working
        ? "This course's PDFs are still being processed. Try again when one is ready."
        : "None of this course's PDFs could be read. Open one and press Try again, or add another PDF.",
      working ? "retry" : undefined);
  }
  return { kind: "course" as const, id, name: course.name, hash: `course:${id}`, docs: ready.map((m) => ({ id: m.id, name: m.filename })) };
}
