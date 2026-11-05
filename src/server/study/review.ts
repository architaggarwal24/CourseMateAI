// The spaced-repetition review queue (Stage 4.4; port of backend/services/review_service.py), scheduled with FSRS
// (ts-fsrs, default parameters, 90% retention). ONE queue per user across documents. Cards come from a missed
// arena / quiz / exam question (mastery.record) and from flashcards (first grade, or "Add deck to review").
// Grades: 1 Again, 2 Hard, 3 Good, 4 Easy. New cards per (UTC) day are limited; a learning card due within
// LEARN_AHEAD shows now, so a session can finish. A grade names the card's `reps` as the client saw it: a double
// submit is refused with 409 review_stale instead of counting twice.
import { and, count, desc, eq, gt, inArray, lte, min, sql, sum } from "drizzle-orm";
import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade, type State } from "ts-fsrs";
import type { CurrentUser, RequestContext } from "../context";
import { courses, documents, reviewItems, reviewLogs } from "../db/schema";
import { HttpError } from "../http";
import { cleanText, questionKey, stamp } from "./text";
import { courseMembers } from "../documents";
import { hasFeature } from "./plan";


export const NEW_PER_DAY = 20;
export const LEARN_AHEAD_MS = 20 * 60_000;
export const MAX_CARDS_PER_ADD = 100;
const MAX_FRONT = 2000, MAX_BACK = 1000, MAX_EXPLANATION = 2000, MAX_CONCEPT = 200;
export const SOURCES = ["flashcard", "arena", "quiz", "exam"] as const;
export type Source = (typeof SOURCES)[number];
const STATE_NAMES: Record<number, string> = { 1: "learning", 2: "review", 3: "relearning" };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));
const preview = fsrs(generatorParameters({ enable_fuzz: false }));

type Row = typeof reviewItems.$inferSelect;
export const itemKey = (front: string) => questionKey(front).slice(0, 500);
export const conceptKey = (concept: unknown) => questionKey(String(concept ?? "")).slice(0, MAX_CONCEPT);
const today = (now: Date) => stamp(now).slice(0, 10);

/** Put a card in the queue or, if it is already there, bring it due now (a fresh miss). Its id, or null. */
export async function upsertItem(ctx: RequestContext, userId: number, docHash: string, card: {
  front: unknown; back: unknown; source: string; explanation?: unknown; concept?: unknown;
}, now = new Date()): Promise<number | null> {
  const front = cleanText(card.front, MAX_FRONT), back = cleanText(card.back, MAX_BACK);
  const key = itemKey(front);
  if (!front || !back || !key || !docHash || !(SOURCES as readonly string[]).includes(card.source)) return null;
  const concept = cleanText(card.concept, MAX_CONCEPT, true) || null;
  const explanation = cleanText(card.explanation, MAX_EXPLANATION) || null;
  const t = stamp(now);
  const row = await ctx.db.insert(reviewItems).values({
    userId, docHash, itemKey: key, source: card.source, concept, conceptKey: concept ? conceptKey(concept) : null,
    front, back, explanation, due: t, createdAt: t, updatedAt: t,
  }).onConflictDoUpdate({
    target: [reviewItems.userId, reviewItems.docHash, reviewItems.itemKey],
    set: {
      back, updatedAt: t,
      explanation: sql`COALESCE(excluded.explanation, ${reviewItems.explanation})`,
      concept: sql`COALESCE(excluded.concept, ${reviewItems.concept})`,
      conceptKey: sql`COALESCE(excluded.concept_key, ${reviewItems.conceptKey})`,
      due: sql`MIN(${reviewItems.due}, excluded.due)`,
    },
  }).returning({ id: reviewItems.id }).get();
  return row?.id ?? null;
}

function toCard(r: Row): Card {
  return {
    due: new Date(r.due), stability: r.stability, difficulty: r.difficulty, elapsed_days: r.elapsedDays,
    scheduled_days: r.scheduledDays, learning_steps: r.step, reps: r.reps, lapses: r.lapses, state: r.state as State,
    last_review: r.lastReview ? new Date(r.lastReview) : undefined,
  };
}

function intervals(r: Row, now: Date): Record<string, number> {
  const card = r.reps ? toCard(r) : { ...createEmptyCard(now), due: new Date(r.due) };
  const out: Record<string, number> = {};
  for (const g of [1, 2, 3, 4] as Grade[]) out[String(g)] = Math.max(0, Math.round((preview.next(card, now, g).card.due.getTime() - now.getTime()) / 1000));
  return out;
}

type DocRef = { session_id: string | null; name: string | null };

/** The card's document: the user's latest one with that content, or its course. */
async function docRefs(ctx: RequestContext, userId: number, hashes: string[]): Promise<Map<string, DocRef>> {
  const out = new Map<string, DocRef>();
  const fileHashes = hashes.filter((h) => !h.startsWith("course:"));
  const courseIds = hashes.filter((h) => h.startsWith("course:")).map((h) => h.slice(7));
  if (fileHashes.length) {
    const rows = await ctx.db.select({ id: documents.id, name: documents.filename, hash: documents.fileHash }).from(documents)
      .where(and(eq(documents.userId, userId), inArray(documents.fileHash, fileHashes))).orderBy(desc(documents.lastUsedAt)).all();
    for (const r of rows) if (!out.has(r.hash)) out.set(r.hash, { session_id: r.id, name: r.name });
  }
  if (courseIds.length) {
    const rows = await ctx.db.select({ id: courses.id, name: courses.name }).from(courses)
      .where(and(eq(courses.userId, userId), inArray(courses.id, courseIds))).all();
    for (const r of rows) out.set(`course:${r.id}`, { session_id: r.id, name: r.name });
  }
  return out;
}

async function publicItems(ctx: RequestContext, userId: number, rows: Row[], now: Date, withIntervals = true) {
  const refs = await docRefs(ctx, userId, [...new Set(rows.map((r) => r.docHash))]);
  return rows.map((r) => publicItem(r, now, refs.get(r.docHash), withIntervals));
}

function publicItem(r: Row, now: Date, doc: DocRef | undefined, withIntervals: boolean) {
  return {
    id: r.id, front: r.front, back: r.back, explanation: r.explanation, concept: r.concept, source: r.source,
    state: r.reps ? STATE_NAMES[r.state] ?? "learning" : "new", due: r.due, reps: r.reps, lapses: r.lapses,
    document: doc ?? { session_id: null, name: null },
    ...(withIntervals ? { intervals: intervals(r, now) } : {}),
  };
}

async function countsToday(ctx: RequestContext, userId: number, now: Date) {
  const r = await ctx.db.select({ n: count(), fresh: sum(sql`${reviewLogs.wasNew}`) }).from(reviewLogs)
    .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.localDate, today(now)))).get();
  return { reviewed: Number(r?.n ?? 0), new: Number(r?.fresh ?? 0) };
}

async function getItem(ctx: RequestContext, userId: number, id: number): Promise<Row> {
  const row = Number.isInteger(id) ? await ctx.db.select().from(reviewItems).where(and(eq(reviewItems.id, id), eq(reviewItems.userId, userId))).get() : undefined;
  if (!row) throw new HttpError(404, "review_item_not_found", "That card isn't in your review queue.");
  return row;
}

/** Learning cards (incl. those due within LEARN_AHEAD), then due reviews (most overdue first), then today's new cards. */
export async function queue(ctx: RequestContext, userId: number, { limit = 20, hashes, now = new Date() }: { limit?: number; hashes?: string[] | null; now?: Date } = {}) {
  const n = Math.max(1, Math.min(Math.trunc(limit) || 20, 100));
  const scope = hashes?.length ? inArray(reviewItems.docHash, hashes) : undefined;
  const base = (...c: unknown[]) => and(eq(reviewItems.userId, userId), ...(c as never[]), ...(scope ? [scope] : []));
  const learning = await ctx.db.select().from(reviewItems)
    .where(base(gt(reviewItems.reps, 0), inArray(reviewItems.state, [1, 3]), lte(reviewItems.due, stamp(new Date(now.getTime() + LEARN_AHEAD_MS)))))
    .orderBy(reviewItems.due).limit(n).all();
  const review = await ctx.db.select().from(reviewItems)
    .where(base(gt(reviewItems.reps, 0), eq(reviewItems.state, 2), lte(reviewItems.due, stamp(now))))
    .orderBy(reviewItems.due).limit(n).all();
  const newLeft = Math.max(0, NEW_PER_DAY - (await countsToday(ctx, userId, now)).new);
  const fresh = newLeft ? await ctx.db.select().from(reviewItems)
    .where(base(eq(reviewItems.reps, 0), lte(reviewItems.due, stamp(now))))
    .orderBy(reviewItems.due, reviewItems.id).limit(Math.min(n, newLeft)).all() : [];
  return publicItems(ctx, userId, [...learning, ...review, ...fresh].slice(0, n), now);
}

export async function stats(ctx: RequestContext, userId: number, now = new Date()) {
  const t = stamp(now);
  const c = async (...w: unknown[]) => Number((await ctx.db.select({ n: count() }).from(reviewItems).where(and(eq(reviewItems.userId, userId), ...(w as never[]))).get())?.n ?? 0);
  const todayCounts = await countsToday(ctx, userId, now);
  const newLeft = Math.max(0, NEW_PER_DAY - todayCounts.new);
  const newReady = await c(eq(reviewItems.reps, 0), lte(reviewItems.due, t));
  const learning = await c(gt(reviewItems.reps, 0), inArray(reviewItems.state, [1, 3]), lte(reviewItems.due, stamp(new Date(now.getTime() + LEARN_AHEAD_MS))));
  const review = await c(gt(reviewItems.reps, 0), eq(reviewItems.state, 2), lte(reviewItems.due, t));
  const next = await ctx.db.select({ d: min(reviewItems.due) }).from(reviewItems).where(and(eq(reviewItems.userId, userId), gt(reviewItems.due, t))).get();
  const bySource: Record<string, number> = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  for (const r of await ctx.db.select({ source: reviewItems.source, n: count() }).from(reviewItems).where(eq(reviewItems.userId, userId)).groupBy(reviewItems.source).all()) {
    bySource[r.source] = Number(r.n);
  }
  return {
    due: learning + review + Math.min(newReady, newLeft), learning, review, new: Math.min(newReady, newLeft),
    new_waiting: newReady, new_left_today: newLeft, reviewed_today: todayCounts.reviewed,
    total: Object.values(bySource).reduce((a, b) => a + b, 0), by_source: bySource, next_due_at: next?.d ?? null,
  };
}

export async function addCards(ctx: RequestContext, userId: number, docHash: string, cards: Record<string, unknown>[], source: Source = "flashcard", now = new Date()) {
  let added = 0, existing = 0, skipped = 0;
  for (const c of cards.slice(0, MAX_CARDS_PER_ADD)) {
    const key = itemKey(cleanText(c.front, MAX_FRONT));
    const had = key && await ctx.db.select({ id: reviewItems.id }).from(reviewItems)
      .where(and(eq(reviewItems.userId, userId), eq(reviewItems.docHash, docHash), eq(reviewItems.itemKey, key))).get();
    if (had) { existing++; continue; }
    const id = await upsertItem(ctx, userId, docHash, { front: c.front, back: c.back, explanation: c.explanation, concept: c.concept ?? c.topic, source }, now);
    if (id) added++; else skipped++;
  }
  return { added, existing, skipped };
}

export type MasteryRecorder = (docHash: string, concept: string, correct: boolean) => Promise<unknown>;

/** Apply one grade. `reps` (what the client saw) guards against counting a grade twice. */
export async function grade(ctx: RequestContext, userId: number, itemId: number, rating: unknown, opts: {
  reps?: number | null; durationMs?: number | null; now?: Date; mastery?: MasteryRecorder | null;
} = {}) {
  const r = Number(rating);
  if (![1, 2, 3, 4].includes(r)) throw new HttpError(400, "invalid_input", "Grade must be 1 (Again), 2 (Hard), 3 (Good) or 4 (Easy).");
  const now = opts.now ?? new Date();
  const row = await getItem(ctx, userId, itemId);
  if (opts.reps !== undefined && opts.reps !== null && Number(opts.reps) !== row.reps) {
    throw new HttpError(409, "review_stale", "This card was already graded.", null, { item: (await publicItems(ctx, userId, [row], now))[0] });
  }
  const wasNew = row.reps === 0;
  const before = wasNew ? { ...createEmptyCard(now), due: new Date(row.due) } : toCard(row);
  const { card } = scheduler.next(before, now, r as Grade);
  const changed = await ctx.db.update(reviewItems).set({
    state: card.state, step: card.learning_steps, stability: card.stability, difficulty: card.difficulty,
    elapsedDays: card.elapsed_days, scheduledDays: card.scheduled_days, due: stamp(card.due), lastReview: stamp(now),
    reps: row.reps + 1, lapses: card.lapses, updatedAt: stamp(now),
  }).where(and(eq(reviewItems.id, row.id), eq(reviewItems.reps, row.reps))).returning({ id: reviewItems.id }).all();
  if (changed.length !== 1) throw new HttpError(409, "review_stale", "This card was already graded.");
  const ms = opts.durationMs;
  await ctx.db.insert(reviewLogs).values({
    userId, itemId: row.id, rating: r, wasNew, reviewedAt: stamp(now), localDate: today(now),
    durationMs: ms === undefined || ms === null ? null : Math.max(0, Math.min(Math.trunc(Number(ms)) || 0, 3_600_000)),
  });
  const mastery = opts.mastery && row.concept ? await opts.mastery(row.docHash, row.concept, r > 1) : null;
  const fresh = await getItem(ctx, userId, row.id);
  return { item: (await publicItems(ctx, userId, [fresh], now, false))[0], mastery, was_new: wasNew };
}

/** A flashcard graded in the Flashcards tab joins the queue; the first time only, that grade is its first review. */
export async function gradeFirst(ctx: RequestContext, userId: number, docHash: string, card: Record<string, unknown>, correct: boolean, now = new Date()) {
  const id = await upsertItem(ctx, userId, docHash, { front: card.front, back: card.back, explanation: card.explanation, concept: card.concept, source: "flashcard" }, now);
  if (id === null) return null;
  const row = await getItem(ctx, userId, id);
  if (row.reps === 0) return (await grade(ctx, userId, id, correct ? 3 : 1, { reps: 0, now })).item;
  return (await publicItems(ctx, userId, [row], now, false))[0];
}

export async function removeItem(ctx: RequestContext, userId: number, id: number) {
  await getItem(ctx, userId, id);
  await ctx.db.delete(reviewItems).where(and(eq(reviewItems.id, id), eq(reviewItems.userId, userId)));
}


// ── for the routes ───────────────────────────────────────────────────────────────────────────────────────────

/** The cards a review of this document covers: one document's, or a course's own and its documents'. */
export async function scopeHashes(ctx: RequestContext, user: CurrentUser, sessionId: string): Promise<string[]> {
  const d = await ctx.db.select({ h: documents.fileHash }).from(documents).where(and(eq(documents.id, sessionId), eq(documents.userId, user.id))).get();
  if (d) return [d.h];
  const c = await ctx.db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, sessionId), eq(courses.userId, user.id))).get();
  if (!c) throw new HttpError(404, "document_not_found", "That document couldn't be found. It may have been deleted.", "reupload");
  return [`course:${c.id}`, ...(await courseMembers(ctx, c.id)).map((m) => m.fileHash)];
}

/** The due counts, with `locked` saying whether this plan has the review queue. */
export async function statsFor(ctx: RequestContext, user: CurrentUser) {
  return { ...(await stats(ctx, user.id)), locked: !(await hasFeature(ctx, user, "review_queue")) };
}
