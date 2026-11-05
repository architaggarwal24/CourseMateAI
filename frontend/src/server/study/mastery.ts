// Concept mastery (Stage 4.4; port of backend/services/mastery_service.py): which concepts of a document a user
// keeps getting wrong. Written by quiz answers, flashcard and review grades, exams (and the arena in 4.5). A wrong
// answer keeps the question for the review deck and puts it in the review queue.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { RequestContext } from "../context";
import { conceptMastery, courses, documents, missedQuestions } from "../db/schema";
import { conceptKey, upsertItem } from "./review";
import { questionKey, stamp } from "./text";

const MAX_CONCEPT_CHARS = 200;
const RECENCY_HALF_LIFE_DAYS = 7;
export const NEMESIS_MIN_CONCEPTS = 3;

/** The content hash of the user's document, or `course:<id>` for a course of theirs; null if not theirs. */
export async function docHashFor(ctx: RequestContext, userId: number, sessionId: string): Promise<string | null> {
  const d = await ctx.db.select({ h: documents.fileHash }).from(documents).where(and(eq(documents.id, sessionId), eq(documents.userId, userId))).get();
  if (d) return d.h;
  const c = await ctx.db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, sessionId), eq(courses.userId, userId))).get();
  return c ? `course:${c.id}` : null;
}

export interface MissedQuestion { question?: unknown; correct_answer?: unknown; explanation?: unknown }

/** Count one answer about `concept`. Its new counters, or null when there is no usable concept. */
export async function record(ctx: RequestContext, userId: number, docHash: string, rawConcept: unknown, correct: boolean,
  { question, source = "arena", now = new Date() }: { question?: MissedQuestion | null; source?: string; now?: Date } = {}) {
  const concept = String(rawConcept ?? "").split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_CONCEPT_CHARS);
  const key = conceptKey(concept);
  if (!key || !docHash) return null;
  const t = stamp(now);
  await ctx.db.insert(conceptMastery).values({
    userId, docHash, conceptKey: key, concept, seen: 1, correct: correct ? 1 : 0, wrongStreak: correct ? 0 : 1,
    lastSeenAt: t, lastWrongAt: correct ? null : t,
  }).onConflictDoUpdate({
    target: [conceptMastery.userId, conceptMastery.docHash, conceptMastery.conceptKey],
    set: {
      concept, seen: sql`${conceptMastery.seen} + 1`, correct: sql`${conceptMastery.correct} + excluded.correct`,
      wrongStreak: sql`CASE WHEN excluded.correct = 1 THEN 0 ELSE ${conceptMastery.wrongStreak} + 1 END`,
      lastSeenAt: t, lastWrongAt: sql`COALESCE(excluded.last_wrong_at, ${conceptMastery.lastWrongAt})`,
    },
  });
  const text = String(question?.question ?? "").trim();
  if (!correct && text) {
    await ctx.db.insert(missedQuestions).values({
      userId, docHash, textKey: questionKey(text).slice(0, 500) || key, conceptKey: key, concept, source,
      question: text.slice(0, 2000), correctAnswer: String(question?.correct_answer ?? "").slice(0, 1000),
      explanation: String(question?.explanation ?? "").slice(0, 2000) || null, missedAt: t,
    }).onConflictDoUpdate({ target: [missedQuestions.userId, missedQuestions.docHash, missedQuestions.textKey], set: { missedAt: t, source } });
    await upsertItem(ctx, userId, docHash, {
      front: text, back: String(question?.correct_answer ?? ""), explanation: question?.explanation, concept,
      source: ["arena", "quiz", "exam"].includes(source) ? source : "arena",
    }, now);
  }
  const row = await ctx.db.select({ concept: conceptMastery.concept, seen: conceptMastery.seen, correct: conceptMastery.correct, wrong_streak: conceptMastery.wrongStreak })
    .from(conceptMastery).where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.docHash, docHash), eq(conceptMastery.conceptKey, key))).get();
  return row ?? null;
}

/** Concepts answered wrong at least once, weakest first (misses, the current wrong streak, how recent). */
export async function weakConcepts(ctx: RequestContext, userId: number, docHash: string, limit = 8, now = new Date()) {
  const rows = await ctx.db.select().from(conceptMastery)
    .where(and(eq(conceptMastery.userId, userId), eq(conceptMastery.docHash, docHash), gt(conceptMastery.seen, conceptMastery.correct))).all();
  const out = rows.map((r) => {
    const days = r.lastWrongAt ? Math.max(0, (now.getTime() - new Date(r.lastWrongAt).getTime()) / 86_400_000) : null;
    const recency = days === null ? 0 : Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
    const misses = r.seen - r.correct;
    return { concept: r.concept, seen: r.seen, correct: r.correct, misses, wrong_streak: r.wrongStreak, last_wrong_at: r.lastWrongAt,
             score: Math.round((misses + 1.5 * r.wrongStreak + 2 * recency) * 1000) / 1000 };
  });
  out.sort((a, b) => b.score - a.score || b.misses - a.misses || a.concept.localeCompare(b.concept));
  return out.slice(0, Math.max(1, limit));
}

/** Flashcards from the stored missed questions (front = the question, back = its answer). No AI call. */
export async function reviewDeck(ctx: RequestContext, userId: number, docHash: string, limit = 50) {
  const rows = await ctx.db.select().from(missedQuestions)
    .where(and(eq(missedQuestions.userId, userId), eq(missedQuestions.docHash, docHash)))
    .orderBy(desc(missedQuestions.missedAt)).limit(Math.max(1, Math.min(limit, 100))).all();
  return rows.map((r) => ({ front: r.question, back: r.correctAnswer, explanation: r.explanation, concept: r.concept, topic: r.concept,
                            difficulty: "medium", source: r.source, missed_at: r.missedAt }));
}

/** How well a concept is known, from its counters. */
export function heat(seen: number, correct: number, wrongStreak: number): "new" | "weak" | "learning" | "strong" {
  if (!seen) return "new";
  const acc = correct / seen;
  if (wrongStreak >= 2 || acc < 0.5) return "weak";
  if (seen >= 2 && acc >= 0.8 && !wrongStreak) return "strong";
  return "learning";
}
