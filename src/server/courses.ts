// Courses on the Worker (Stage 4.2; the same rules as backend/services/course_service.py): a named group of the
// user's documents, studied together. A course id stands wherever a document id does (GET /documents/{id} answers
// with the course seen as one document). Deleting a course leaves its documents. Courses are a Sage feature.
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { CurrentUser, RequestContext } from "./context";
import { conceptMastery, courseDocuments, courses, documents, exams, reviewItems } from "./db/schema";
import { courseMembers } from "./documents";
import { HttpError } from "./http";
import { limits, nowIso, planLimit, requireFeature, tierFor } from "./plans";

export const MAX_COURSES = 30;
export const MAX_DOCUMENTS = 20;
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

function notFound(): HttpError {
  return new HttpError(404, "course_not_found", "That course doesn't exist.");
}

function cleanName(name: unknown): string {
  const n = String(name ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (!n) throw new HttpError(400, "invalid_input", "Give the course a name.", null, { field: "name" });
  return n.slice(0, MAX_NAME);
}

function cleanDescription(d: unknown): string | null {
  return String(d ?? "").trim().slice(0, MAX_DESCRIPTION) || null;
}

export async function gate(ctx: RequestContext, user: CurrentUser) {
  const tier = await tierFor(ctx.db, user);
  requireFeature(tier, "courses");
  return tier;
}

async function row(ctx: RequestContext, user: CurrentUser, id: string) {
  const r = await ctx.db.select().from(courses).where(eq(courses.id, id)).get();
  if (!r || r.userId !== user.id) throw notFound();
  return r;
}

async function ownedDocuments(ctx: RequestContext, user: CurrentUser, ids: unknown): Promise<string[]> {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
  if (list.length > MAX_DOCUMENTS) throw new HttpError(400, "invalid_input", `A course holds at most ${MAX_DOCUMENTS} documents.`);
  if (!list.length) return [];
  const found = await ctx.db.select({ id: documents.id }).from(documents)
    .where(and(inArray(documents.id, list), eq(documents.userId, user.id))).all();
  const have = new Set(found.map((f) => f.id));
  const missing = list.find((d) => !have.has(d));
  if (missing) throw new HttpError(404, "document_not_found", "One of those documents couldn't be found.", null, { document_id: missing });
  return list;
}

export async function publicCourse(ctx: RequestContext, c: typeof courses.$inferSelect) {
  const members = await courseMembers(ctx, c.id);
  return {
    id: c.id, name: c.name, description: c.description, created_at: c.createdAt, updated_at: c.updatedAt,
    documents: members.map((m) => ({ id: m.id, filename: m.filename, status: m.status, chunks: m.chunks, pdf_available: m.pdfStored })),
    ready: members.filter((m) => m.status === "ready").length,
  };
}

async function setMembers(ctx: RequestContext, courseId: string, ids: string[], now: string) {
  await ctx.db.delete(courseDocuments).where(eq(courseDocuments.courseId, courseId));
  if (ids.length) await ctx.db.insert(courseDocuments).values(ids.map((d, i) => ({ courseId, documentId: d, position: i, addedAt: now })));
}

export async function listCourses(ctx: RequestContext, user: CurrentUser) {
  await gate(ctx, user);
  const rows = await ctx.db.select().from(courses).where(eq(courses.userId, user.id)).orderBy(desc(courses.updatedAt)).all();
  return Promise.all(rows.map((r) => publicCourse(ctx, r)));
}

export async function getCourse(ctx: RequestContext, user: CurrentUser, id: string) {
  await gate(ctx, user);
  return publicCourse(ctx, await row(ctx, user, id));
}

export async function createCourse(ctx: RequestContext, user: CurrentUser, body: { name?: unknown; description?: unknown; document_ids?: unknown }) {
  const tier = await gate(ctx, user);
  const name = cleanName(body.name);
  const ids = await ownedDocuments(ctx, user, body.document_ids);
  const n = (await ctx.db.select({ n: count() }).from(courses).where(eq(courses.userId, user.id)).get())?.n ?? 0;
  const allowed = Math.min(MAX_COURSES, limits(tier).courses);
  if (n >= allowed) {
    throw planLimit(tier, "courses", n, allowed, `Your plan holds ${allowed} courses and you have ${n}. Delete one, or upgrade for more.`);
  }
  const id = crypto.randomUUID();
  const now = nowIso();
  await ctx.db.insert(courses).values({ id, userId: user.id, name, description: cleanDescription(body.description), createdAt: now, updatedAt: now });
  // Security fix #11: parallel requests can all pass the count above; count again with the row in, and take it back
  // if this one went over (two racing for the last slot may both be refused, never both kept).
  const after = (await ctx.db.select({ n: count() }).from(courses).where(eq(courses.userId, user.id)).get())?.n ?? 0;
  if (after > allowed) {
    await ctx.db.delete(courses).where(eq(courses.id, id));
    throw planLimit(tier, "courses", after - 1, allowed, `Your plan holds ${allowed} courses and you have ${after - 1}. Delete one, or upgrade for more.`);
  }
  await setMembers(ctx, id, ids, now);
  return getCourse(ctx, user, id);
}

export async function updateCourse(ctx: RequestContext, user: CurrentUser, id: string, body: { name?: unknown; description?: unknown; document_ids?: unknown }) {
  await gate(ctx, user);
  const r = await row(ctx, user, id);
  const now = nowIso();
  const set: Partial<typeof courses.$inferInsert> = { updatedAt: now };
  if (body.name !== undefined && body.name !== null) set.name = cleanName(body.name);
  if (body.description !== undefined && body.description !== null) set.description = cleanDescription(body.description);
  if (body.document_ids !== undefined && body.document_ids !== null) await setMembers(ctx, r.id, await ownedDocuments(ctx, user, body.document_ids), now);
  await ctx.db.update(courses).set(set).where(eq(courses.id, r.id));
  return getCourse(ctx, user, id);
}

export async function deleteCourse(ctx: RequestContext, user: CurrentUser, id: string) {
  await gate(ctx, user);
  const r = await row(ctx, user, id);
  await ctx.db.delete(courses).where(eq(courses.id, r.id));
}

/** How the course is going, from stored data only: concept mastery over its documents (and what was studied on the
 *  course as a whole), the review cards due, and the exams taken on it. */
export async function courseProgress(ctx: RequestContext, user: CurrentUser, id: string) {
  await gate(ctx, user);
  const r = await row(ctx, user, id);
  const members = await courseMembers(ctx, r.id);
  const hashes = [...members.map((m) => m.fileHash), `course:${r.id}`];
  const t = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const memberHashes = [...new Set(members.map((m) => m.fileHash))];
  // Every read below in one round trip (a D1 batch); the per-document numbers are one grouped query, not one each.
  const [concepts, cardRows, taken, docRows] = await ctx.db.batch([
    ctx.db.select({
      key: conceptMastery.conceptKey, concept: sql<string>`MAX(${conceptMastery.concept})`, seen: sql<number>`SUM(${conceptMastery.seen})`,
      correct: sql<number>`SUM(${conceptMastery.correct})`, streak: sql<number>`MAX(${conceptMastery.wrongStreak})`,
    }).from(conceptMastery).where(and(eq(conceptMastery.userId, user.id), inArray(conceptMastery.docHash, hashes))).groupBy(conceptMastery.conceptKey),
    ctx.db.select({ total: count(), due: sql<number>`COALESCE(SUM(CASE WHEN ${reviewItems.due} <= ${t} AND ${reviewItems.reps} > 0 THEN 1 ELSE 0 END), 0)` })
      .from(reviewItems).where(and(eq(reviewItems.userId, user.id), inArray(reviewItems.docHash, hashes))),
    ctx.db.select({ id: exams.id, accuracy: exams.accuracy, submitted_at: exams.submittedAt }).from(exams)
      .where(and(eq(exams.userId, user.id), inArray(exams.docHash, hashes), eq(exams.status, "graded"))).orderBy(desc(exams.submittedAt)).limit(5),
    ctx.db.select({ hash: conceptMastery.docHash, n: count(), seen: sql<number>`COALESCE(SUM(${conceptMastery.seen}), 0)`, correct: sql<number>`COALESCE(SUM(${conceptMastery.correct}), 0)` })
      .from(conceptMastery).where(and(eq(conceptMastery.userId, user.id), inArray(conceptMastery.docHash, memberHashes.length ? memberHashes : [""])))
      .groupBy(conceptMastery.docHash),
  ]);
  const cards = cardRows[0];
  const byHash = new Map(docRows.map((d) => [d.hash, d]));
  const strong = concepts.filter((c) => c.seen >= 2 && c.correct / c.seen >= 0.8 && !c.streak).length;
  const weak = concepts.filter((c) => c.seen > c.correct)
    .sort((a, b) => (-(a.seen - a.correct) - 1.5 * a.streak) - (-(b.seen - b.correct) - 1.5 * b.streak) || a.concept.localeCompare(b.concept));
  const perDoc = members.map((m) => {
    const d = byHash.get(m.fileHash);
    const seen = Number(d?.seen ?? 0);
    return { id: m.id, filename: m.filename, concepts: Number(d?.n ?? 0), answered: seen,
             accuracy: seen ? Math.round((Number(d?.correct ?? 0) / seen) * 10_000) / 10_000 : null };
  });
  const answered = concepts.reduce((a, c) => a + Number(c.seen), 0);
  const right = concepts.reduce((a, c) => a + Number(c.correct), 0);
  return {
    course_id: r.id,
    concepts: { seen: concepts.length, strong, weak: weak.length, weakest: weak.slice(0, 5).map((c) => c.concept) },
    answers: { total: answered, correct: right, accuracy: answered ? Math.round((right / answered) * 10_000) / 10_000 : null },
    review: { cards: Number(cards?.total ?? 0), due: Number(cards?.due ?? 0) },
    exams: taken,
    documents: perDoc,
    mastery: concepts.length ? Math.round((strong / concepts.length) * 10_000) / 10_000 : 0,
  };
}

export async function courseCount(ctx: RequestContext, userId: number): Promise<number> {
  return (await ctx.db.select({ n: count() }).from(courses).where(eq(courses.userId, userId)).get())?.n ?? 0;
}
