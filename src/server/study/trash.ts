// The Trash (data-loss safety, after the BreakingBreach "Protect your app from data loss" checklist: controls 11, 17,
// 18). Deleting a PDF or a course moves it here for TRASH_DAYS; it can be restored until then, or deleted for good.
//
// A trashed item leaves the live tables (documents / courses) entirely, so every other query keeps working without
// knowing the Trash exists. What it needs to come back is kept beside it:
//   a PDF     its row (JSON), its chunks (trash_chunks), its course memberships; its R2 file and search vectors stay
//             where they are until it is deleted for good
//   a course  its row and its list of PDFs (a PDF deleted since is simply left out on restore)
// Moving in and out is one D1 batch (a transaction: all or nothing). Every move is written to deletion_log.
import { and, count, eq, inArray, lt, sql } from "drizzle-orm";
import type { CurrentUser, RequestContext } from "../context";
import { courseDocuments, courses, deletionLog, documentChunks, documents, trash, trashChunks } from "../db/schema";
import { HttpError } from "../http";
import { limits, nowIso, planLimit, tierFor } from "../account/plans";
import { vectorId, type SearchDeps } from "../search";
import { MAX_COURSES, r2Key } from "./limits";

/** How long a deleted PDF or course can be restored. */
export const TRASH_DAYS = 30;
/** How long the deletion log keeps a line. */
export const LOG_DAYS = 365;

type DocumentRow = typeof documents.$inferSelect;
type CourseRow = typeof courses.$inferSelect;
type TrashRow = typeof trash.$inferSelect;
interface Link { course_id?: string; document_id?: string; position: number; added_at: string }

const plusDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();
const daysLeft = (expiresAt: string, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 86_400_000));

function logLine(userId: number, actorId: number, action: typeof deletionLog.$inferInsert["action"], kind: "document" | "course" | "account", itemId: string | null, itemName: string | null, at = nowIso()) {
  return { userId, actorId, action, kind, itemId, itemName, at };
}

/** Write a line to the deletion log (and drop lines older than a year). */
export async function logDeletion(ctx: RequestContext, line: ReturnType<typeof logLine>) {
  await ctx.db.batch([
    ctx.db.insert(deletionLog).values(line),
    ctx.db.delete(deletionLog).where(lt(deletionLog.at, plusDays(line.at, -LOG_DAYS))),
  ]);
}
export { logLine };

// ── into the Trash ─────────────────────────────────────────────────────────────────────────────────────────────
export async function trashDocument(ctx: RequestContext, user: CurrentUser, row: DocumentRow, now = nowIso()) {
  const links = await ctx.db.select().from(courseDocuments).where(eq(courseDocuments.documentId, row.id)).all();
  await ctx.db.batch([
    ctx.db.insert(trash).values({
      id: row.id, userId: row.userId, kind: "document", name: row.filename, row: JSON.stringify(row),
      links: JSON.stringify(links.map((l): Link => ({ course_id: l.courseId, position: l.position, added_at: l.addedAt }))),
      deletedAt: now, expiresAt: plusDays(now, TRASH_DAYS),
    }),
    ctx.db.insert(trashChunks).select(
      ctx.db.select({ userId: sql<number>`${row.userId}`.as("user_id"), documentId: documentChunks.documentId, idx: documentChunks.idx, page: documentChunks.page, text: documentChunks.text })
        .from(documentChunks).where(eq(documentChunks.documentId, row.id)),
    ),
    ctx.db.delete(documents).where(eq(documents.id, row.id)),            // its chunks and memberships go with it
    ctx.db.insert(deletionLog).values(logLine(row.userId, user.id, "trashed", "document", row.id, row.filename, now)),
  ]);
}

export async function trashCourse(ctx: RequestContext, user: CurrentUser, row: CourseRow, now = nowIso()) {
  const links = await ctx.db.select().from(courseDocuments).where(eq(courseDocuments.courseId, row.id)).all();
  await ctx.db.batch([
    ctx.db.insert(trash).values({
      id: row.id, userId: row.userId, kind: "course", name: row.name, row: JSON.stringify(row),
      links: JSON.stringify(links.map((l): Link => ({ document_id: l.documentId, position: l.position, added_at: l.addedAt }))),
      deletedAt: now, expiresAt: plusDays(now, TRASH_DAYS),
    }),
    ctx.db.delete(courses).where(eq(courses.id, row.id)),
    ctx.db.insert(deletionLog).values(logLine(row.userId, user.id, "trashed", "course", row.id, row.name, now)),
  ]);
}

// ── what's in it ───────────────────────────────────────────────────────────────────────────────────────────────
export async function listTrash(ctx: RequestContext, deps: SearchDeps | null, user: CurrentUser, now = new Date()) {
  await purgeExpired(ctx, deps, user.id, now);
  const rows = await ctx.db.select().from(trash).where(eq(trash.userId, user.id)).all();
  rows.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return {
    days: TRASH_DAYS,
    items: rows.map((r) => {
      const links = JSON.parse(r.links) as Link[];
      const row = JSON.parse(r.row) as Partial<DocumentRow>;
      return {
        id: r.id, kind: r.kind, name: r.name, deleted_at: r.deletedAt, expires_at: r.expiresAt, days_left: daysLeft(r.expiresAt, now.getTime()),
        ...(r.kind === "document" ? { pages: row.pages ?? null, courses: links.length } : { documents: links.length }),
      };
    }),
  };
}

async function owned(ctx: RequestContext, user: CurrentUser, id: string): Promise<TrashRow> {
  const r = await ctx.db.select().from(trash).where(eq(trash.id, id)).get();
  if (!r || r.userId !== user.id) throw new HttpError(404, "not_in_trash", "That isn't in your Trash (it may have been deleted for good).");
  return r;
}

// ── back out ───────────────────────────────────────────────────────────────────────────────────────────────────
export async function restoreFromTrash(ctx: RequestContext, user: CurrentUser, id: string, now = nowIso()) {
  const r = await owned(ctx, user, id);
  const tier = await tierFor(ctx.db, user);
  const lim = limits(tier);
  if (r.kind === "document") {
    const row = JSON.parse(r.row) as DocumentRow;
    const have = (await ctx.db.select({ n: count() }).from(documents).where(eq(documents.userId, user.id)).get())?.n ?? 0;
    if (have >= lim.documents) {
      throw planLimit(tier, "documents", have, lim.documents, `Your plan holds ${lim.documents} documents and you have ${have}. Delete one first, or upgrade.`);
    }
    if (await ctx.db.select({ id: documents.id }).from(documents).where(eq(documents.id, id)).get()) {
      throw new HttpError(409, "already_restored", "That PDF is already back in your library.");
    }
    const links = JSON.parse(r.links) as Link[];
    const live = links.length
      ? new Set((await ctx.db.select({ id: courses.id }).from(courses).where(and(eq(courses.userId, user.id), inArray(courses.id, links.map((l) => l.course_id!)))).all()).map((c) => c.id))
      : new Set<string>();
    const back = links.filter((l) => live.has(l.course_id!));
    await ctx.db.batch([
      ctx.db.insert(documents).values({ ...row, updatedAt: now }),
      ctx.db.insert(documentChunks).select(
        ctx.db.select({ documentId: trashChunks.documentId, idx: trashChunks.idx, page: trashChunks.page, text: trashChunks.text })
          .from(trashChunks).where(eq(trashChunks.documentId, id)),
      ),
      ...back.map((l) => ctx.db.insert(courseDocuments).values({ courseId: l.course_id!, documentId: id, position: l.position, addedAt: l.added_at }).onConflictDoNothing()),
      ctx.db.delete(trashChunks).where(eq(trashChunks.documentId, id)),
      ctx.db.delete(trash).where(eq(trash.id, id)),
      ctx.db.insert(deletionLog).values(logLine(user.id, user.id, "restored", "document", id, r.name, now)),
    ]);
    return { ok: true, kind: "document" as const, id, name: r.name, courses: back.length };
  }
  const row = JSON.parse(r.row) as CourseRow;
  const n = (await ctx.db.select({ n: count() }).from(courses).where(eq(courses.userId, user.id)).get())?.n ?? 0;
  const allowed = Math.min(MAX_COURSES, lim.courses);
  if (n >= allowed) {
    throw planLimit(tier, "courses", n, allowed, `Your plan holds ${allowed} courses and you have ${n}. Delete one first, or upgrade.`);
  }
  const links = JSON.parse(r.links) as Link[];
  const liveDocs = links.length
    ? new Set((await ctx.db.select({ id: documents.id }).from(documents).where(and(eq(documents.userId, user.id), inArray(documents.id, links.map((l) => l.document_id!)))).all()).map((d) => d.id))
    : new Set<string>();
  const back = links.filter((l) => liveDocs.has(l.document_id!));
  await ctx.db.batch([
    ctx.db.insert(courses).values({ ...row, updatedAt: now }),
    ...back.map((l) => ctx.db.insert(courseDocuments).values({ courseId: id, documentId: l.document_id!, position: l.position, addedAt: l.added_at }).onConflictDoNothing()),
    ctx.db.delete(trash).where(eq(trash.id, id)),
    ctx.db.insert(deletionLog).values(logLine(user.id, user.id, "restored", "course", id, r.name, now)),
  ]);
  return { ok: true, kind: "course" as const, id, name: r.name, documents: back.length };
}

// ── gone for good ──────────────────────────────────────────────────────────────────────────────────────────────
async function destroy(ctx: RequestContext, deps: SearchDeps | null, r: TrashRow, actorId: number, action: "purged" | "expired") {
  if (r.kind === "document") {
    const row = JSON.parse(r.row) as DocumentRow;
    if (row.chunks > 0 && deps) await deps.vectors.deleteByIds(Array.from({ length: row.chunks }, (_, i) => vectorId(row.id, i)));
    if (row.pdfStored) await ctx.env.FILES.delete(r2Key(row.userId, row.id));
  }
  await ctx.db.batch([
    ctx.db.delete(trashChunks).where(eq(trashChunks.documentId, r.id)),
    ctx.db.delete(trash).where(eq(trash.id, r.id)),
    ctx.db.insert(deletionLog).values(logLine(r.userId, actorId, action, r.kind, r.id, r.name)),
  ]);
}

export async function deleteForever(ctx: RequestContext, deps: SearchDeps | null, user: CurrentUser, id: string) {
  const r = await owned(ctx, user, id);
  await destroy(ctx, deps, r, user.id, "purged");
  return { ok: true };
}

/** Items past their 30 days are deleted for good (on any visit to the Trash, and before a new upload). */
export async function purgeExpired(ctx: RequestContext, deps: SearchDeps | null, userId: number, now = new Date()) {
  const old = await ctx.db.select().from(trash).where(and(eq(trash.userId, userId), lt(trash.expiresAt, now.toISOString()))).all();
  for (const r of old) await destroy(ctx, deps, r, userId, "expired");
  return old.length;
}

/** An account being deleted: its trashed PDFs' files and vectors too (the rows go with the account). */
export async function purgeTrashFiles(ctx: RequestContext, deps: SearchDeps | null, userId: number) {
  const rows = await ctx.db.select().from(trash).where(and(eq(trash.userId, userId), eq(trash.kind, "document"))).all();
  for (const r of rows) {
    const row = JSON.parse(r.row) as DocumentRow;
    if (row.chunks > 0 && deps) await deps.vectors.deleteByIds(Array.from({ length: row.chunks }, (_, i) => vectorId(row.id, i)));
    if (row.pdfStored) await ctx.env.FILES.delete(r2Key(row.userId, row.id));
  }
}
