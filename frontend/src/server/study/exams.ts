// Exam mode (Stage 4.4; port of backend/services/exam_service.py + core_brains/exam_brain.py): a timed mock test.
//   create   questions written in parallel batches (one per topic, or a broad angle each), answers kept on the
//            server, the clock = questions x seconds per question. One exam in progress per user (409 names it).
//   answer   save / change / clear an answer and the flag, until graded. No feedback.
//   submit   graded once (compare-and-set): score, time, per-concept and per-difficulty breakdown; every question
//            counts for mastery, every miss joins the review queue. Past the deadline (+ grace) it grades on read.
// The score report is a printable page in the app (Save as PDF), no longer a server-made PDF.
import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { CurrentUser, RequestContext } from "../context";
import { conceptMastery, examAnswers, examQuestions, exams, user as userTable } from "../db/schema";
import { onExamGraded } from "../game/hooks";
import { HttpError } from "../http";
import { requireFeature, tierFor } from "../plans";
import { studyDocs } from "../documents";
import { callerFor } from "../chat";
import type { Caller } from "../ai/run";
import { generateData, search } from "./core";
import * as mastery from "./mastery";
import { BROAD_QUERIES, EXAM_SYSTEM, examPrompt } from "./prompts";
import { examQuestions as parseExam, type ExamQuestion } from "./schemas";
import { newId, questionKey, sameAnswer, stamp, validateTopic } from "./text";

export const LENGTHS = [10, 20, 30] as const;
export const DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;
export const SECONDS_PER_QUESTION: Record<string, number> = { easy: 60, medium: 75, hard: 90, mixed: 75 };
export const MAX_TOPICS = 5;
const GRACE_MS = 5000;
const MIN_SHARE = 0.6;
const BATCH = 10;
const CONTEXT_CHARS = 6000;

type Body = Record<string, unknown>;
type ExamRow = typeof exams.$inferSelect;

export async function gate(ctx: RequestContext, user: CurrentUser) {
  requireFeature(await tierFor(ctx.db, user), "exam_mode");
}

const notFound = () => new HttpError(404, "exam_not_found", "That exam doesn't exist.");

// ── writing the questions ────────────────────────────────────────────────────────────────────────────────────
export function plan(length: number, topics: string[]): [string, string, number][] {
  let sizes: number[] = [];
  for (let left = length; left > 0; left -= sizes.at(-1)!) sizes.push(Math.min(BATCH, left));
  if (topics.length) {
    const n = Math.max(sizes.length, Math.min(topics.length, length));
    sizes = Array.from({ length: n }, (_, i) => Math.floor(length / n) + (i < length % n ? 1 : 0));
    return sizes.flatMap((s, i) => (s ? [[topics[i % topics.length], topics[i % topics.length], s] as [string, string, number]] : []));
  }
  return sizes.map((s, i) => ["the whole document", BROAD_QUERIES[i % BROAD_QUERIES.length], s]);
}

export async function writeExam(ctx: RequestContext, caller: Caller, docs: { id: string; name: string }[], length: number, difficulty: string, topics: string[]): Promise<ExamQuestion[]> {
  const p = plan(length, topics);
  const results = await Promise.allSettled(p.map(async ([focus, query, n]) => {
    const [a, b] = await Promise.all([search(ctx, docs, query, 10), search(ctx, docs, `key concepts ${query}`, 4)]);
    const context = [...a.passages, ...b.passages].map((x) => x.text).filter((t, i, all) => all.indexOf(t) === i).join("\n\n").slice(0, CONTEXT_CHARS);
    const avoid = p.map((x) => x[0]).filter((f) => f !== focus).slice(0, 8).join(", ") || "None";
    return generateData(ctx, caller, "strong", [
      { role: "system", content: EXAM_SYSTEM },
      { role: "user", content: examPrompt({ context, focus, difficulty, n, avoid }) },
    ], parseExam, { temperature: 0.6, maxOutputTokens: 6000 });
  }));
  const seen = new Set<string>();
  const out: ExamQuestion[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") { console.warn("[coursemate] exam batch failed", r.reason instanceof Error ? r.reason.message : r.reason); continue; }
    for (const q of r.value) {
      const k = questionKey(q.question);
      if (!k || seen.has(k) || !q.options.includes(q.correct_answer)) continue;
      seen.add(k);
      out.push(q);
    }
  }
  if (!out.length) {
    const real = results.find((r) => r.status === "rejected" && r.reason instanceof HttpError);
    if (real && real.status === "rejected") throw real.reason;
  }
  return out.slice(0, length);
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────
async function row(ctx: RequestContext, userId: number, id: unknown): Promise<ExamRow> {
  const r = typeof id === "string" && id ? await ctx.db.select().from(exams).where(and(eq(exams.id, id), eq(exams.userId, userId))).get() : undefined;
  if (!r) throw notFound();
  return r;
}

type Q = { idx: number; question: string; options: string[]; correctAnswer: string; explanation: string | null; concept: string; difficulty: string;
           answer: string | null; flagged: boolean; isCorrect: boolean | null };

async function questions(ctx: RequestContext, examId: string): Promise<Q[]> {
  const qs = await ctx.db.select().from(examQuestions).where(eq(examQuestions.examId, examId)).orderBy(examQuestions.idx).all();
  const answers = new Map((await ctx.db.select().from(examAnswers).where(eq(examAnswers.examId, examId)).all()).map((a) => [a.idx, a]));
  return qs.map((q) => {
    const a = answers.get(q.idx);
    return { idx: q.idx, question: q.question, options: JSON.parse(q.optionsJson), correctAnswer: q.correctAnswer, explanation: q.explanation,
             concept: q.concept, difficulty: q.difficulty, answer: a?.answer ?? null, flagged: !!a?.flagged,
             isCorrect: !a || a.correct === null ? null : !!a.correct };
  });
}

const secondsLeft = (r: ExamRow, now: Date) => Math.max(0, Math.floor((new Date(r.deadline).getTime() - now.getTime()) / 1000));

function publicExam(r: ExamRow, qs: Q[], now: Date) {
  const graded = r.status === "graded";
  return {
    id: r.id, status: r.status, session_id: r.sessionId, doc_name: r.docName, length: r.length, difficulty: r.difficulty,
    topics: JSON.parse(r.topicsJson || "[]"), time_limit_s: r.timeLimitS, started_at: r.startedAt, deadline: r.deadline,
    seconds_left: graded ? 0 : secondsLeft(r, now), answered: qs.filter((q) => q.answer !== null).length, total: r.total,
    questions: qs.map((q) => ({
      index: q.idx, question: q.question, options: q.options, answer: q.answer, flagged: q.flagged,
      ...(graded ? { correct_answer: q.correctAnswer, explanation: q.explanation, concept: q.concept, difficulty: q.difficulty, correct: !!q.isCorrect } : {}),
    })),
    ...(graded ? { result: {
      score: r.score, total: r.total, accuracy: r.accuracy, time_used_s: r.timeUsedS, submitted_at: r.submittedAt,
      auto_submitted: !!r.autoSubmitted, ...JSON.parse(r.breakdownJson || "{}"),
    } } : {}),
  };
}

const overdue = (r: ExamRow, now: Date) => now.getTime() > new Date(r.deadline).getTime() + GRACE_MS;

export async function getExam(ctx: RequestContext, userId: number, id: unknown, now = new Date()) {
  let r = await row(ctx, userId, id);
  if (r.status === "active" && overdue(r, now)) {
    await grade(ctx, userId, r, now, true);
    r = await row(ctx, userId, r.id);
  }
  return publicExam(r, await questions(ctx, r.id), now);
}

export async function activeExam(ctx: RequestContext, userId: number, now = new Date()) {
  const r = await ctx.db.select({ id: exams.id }).from(exams).where(and(eq(exams.userId, userId), eq(exams.status, "active"))).orderBy(desc(exams.startedAt)).get();
  if (!r) return null;
  const e = await getExam(ctx, userId, r.id, now);
  return e.status === "active" ? e : null;
}

export async function history(ctx: RequestContext, userId: number, limit = 20) {
  const rows = await ctx.db.select().from(exams).where(eq(exams.userId, userId)).orderBy(desc(exams.startedAt)).limit(Math.max(1, Math.min(limit || 20, 100))).all();
  return rows.map((r) => ({ id: r.id, status: r.status, doc_name: r.docName, session_id: r.sessionId, length: r.length, difficulty: r.difficulty,
                            started_at: r.startedAt, submitted_at: r.submittedAt, score: r.score, total: r.total, accuracy: r.accuracy }));
}

export async function options(ctx: RequestContext, user: CurrentUser, sessionId: string) {
  const study = await studyDocs(ctx, user, sessionId);
  const rows = await ctx.db.select({ concept: conceptMastery.concept }).from(conceptMastery)
    .where(and(eq(conceptMastery.userId, user.id), eq(conceptMastery.docHash, study.hash)))
    .orderBy(desc(sql`${conceptMastery.seen} - ${conceptMastery.correct}`), desc(conceptMastery.seen), conceptMastery.concept).limit(12).all();
  return { lengths: [...LENGTHS], difficulties: [...DIFFICULTIES], seconds_per_question: SECONDS_PER_QUESTION,
           suggested_topics: rows.map((r) => r.concept), max_topics: MAX_TOPICS };
}

// ── creating ─────────────────────────────────────────────────────────────────────────────────────────────────
export async function createExam(ctx: RequestContext, user: CurrentUser, body: Body, now = new Date()) {
  const length = body.length === undefined ? 20 : Number(body.length);
  const difficulty = body.difficulty === undefined ? "mixed" : String(body.difficulty);
  const rawTopics = body.topics === undefined ? [] : body.topics;
  if (!(LENGTHS as readonly number[]).includes(length) || !(DIFFICULTIES as readonly string[]).includes(difficulty)
      || !Array.isArray(rawTopics) || rawTopics.length > MAX_TOPICS) {
    throw new HttpError(422, "validation_error", "Some of the information you entered is invalid.");
  }
  const topics: string[] = [];
  for (const t of rawTopics) {
    const v = validateTopic(t, "topics");
    if (!topics.some((x) => x.toLowerCase() === v.toLowerCase())) topics.push(v);
  }
  const running = await activeExam(ctx, user.id, now);
  if (running) throw new HttpError(409, "exam_in_progress", "Finish (or submit) the exam you started first.", null, { exam_id: running.id });
  const study = await studyDocs(ctx, user, String(body.session_id ?? ""));
  let qs: ExamQuestion[];
  try {
    qs = await writeExam(ctx, await callerFor(ctx, user), study.docs, length, difficulty, topics);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, "generation_failed", "The exam couldn't be written. Please try again.", "retry");
  }
  if (qs.length < Math.max(1, Math.floor(length * MIN_SHARE))) {
    throw new HttpError(503, "generation_failed", "Not enough exam questions could be written from this document. Please try again (or pick broader topics).",
      "retry", { retryable: true, written: qs.length });
  }
  qs = qs.slice(0, length);
  const limit = qs.length * SECONDS_PER_QUESTION[difficulty];
  const id = newId();
  await ctx.db.batch([
    ctx.db.insert(exams).values({
      id, userId: user.id, sessionId: study.id, docHash: study.hash, docName: study.name.slice(0, 200), length: qs.length, difficulty,
      topicsJson: JSON.stringify(topics.slice(0, MAX_TOPICS)), timeLimitS: limit, startedAt: stamp(now),
      deadline: stamp(new Date(now.getTime() + limit * 1000)), total: qs.length,
    }),
    ...qs.map((q, i) => ctx.db.insert(examQuestions).values({
      examId: id, idx: i, question: q.question, optionsJson: JSON.stringify(q.options), correctAnswer: q.correct_answer,
      explanation: q.explanation || null, concept: q.concept || "General", difficulty: q.difficulty || "medium",
    })),
  ] as never);
  return getExam(ctx, user.id, id, now);
}

// ── answering and grading ────────────────────────────────────────────────────────────────────────────────────
export async function answerExam(ctx: RequestContext, user: CurrentUser, id: string, body: Body, now = new Date()) {
  const r = await row(ctx, user.id, id);
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0) throw new HttpError(422, "validation_error", "Some of the information you entered is invalid.", null, { field: "index" });
  if (r.status !== "active" || overdue(r, now)) {
    await getExam(ctx, user.id, id, now);
    throw new HttpError(409, "exam_closed", "This exam is over: answers can't be changed.");
  }
  const q = await ctx.db.select().from(examQuestions).where(and(eq(examQuestions.examId, r.id), eq(examQuestions.idx, index))).get();
  if (!q) throw new HttpError(404, "question_not_found", "That question isn't part of this exam.");
  const current = await ctx.db.select().from(examAnswers).where(and(eq(examAnswers.examId, r.id), eq(examAnswers.idx, index))).get();
  let picked = current?.answer ?? null;
  if (body.clear === true) picked = null;
  else if (body.answer !== undefined && body.answer !== null) {
    picked = (JSON.parse(q.optionsJson) as string[]).find((o) => sameAnswer(o, body.answer)) ?? null;
    if (picked === null) throw new HttpError(400, "invalid_answer", "Pick one of the answer options.");
  }
  const flagged = typeof body.flagged === "boolean" ? body.flagged : !!current?.flagged;
  await ctx.db.insert(examAnswers).values({ examId: r.id, idx: index, answer: picked, flagged, answeredAt: stamp(now) })
    .onConflictDoUpdate({ target: [examAnswers.examId, examAnswers.idx], set: { answer: picked, flagged, answeredAt: stamp(now) } });
  const answered = (await ctx.db.select({ n: count() }).from(examAnswers).where(and(eq(examAnswers.examId, r.id), isNotNull(examAnswers.answer))).get())?.n ?? 0;
  return { ok: true, index, answer: picked, flagged, answered, seconds_left: secondsLeft(r, now) };
}

export function breakdown(qs: { concept: string; difficulty: string; isCorrect: boolean | null; answer: string | null }[]) {
  const group = (key: "concept" | "difficulty") => {
    const g = new Map<string, { correct: number; total: number }>();
    for (const q of qs) {
      const b = g.get(q[key]) ?? { correct: 0, total: 0 };
      b.total++; b.correct += q.isCorrect ? 1 : 0;
      g.set(q[key], b);
    }
    return [...g].map(([k, v]) => ({ [key]: k, ...v, accuracy: Math.round((v.correct / v.total) * 10_000) / 10_000 }) as
      { concept?: string; difficulty?: string; correct: number; total: number; accuracy: number });
  };
  const concepts = group("concept").sort((a, b) => a.accuracy - b.accuracy || b.total - a.total || String(a.concept).localeCompare(String(b.concept)));
  const order: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  const difficulties = group("difficulty").sort((a, b) => (order[String(a.difficulty)] ?? 9) - (order[String(b.difficulty)] ?? 9));
  return { concepts, difficulties, unanswered: qs.filter((q) => q.answer === null).length,
           weak_concepts: concepts.filter((c) => c.accuracy < 0.6).map((c) => c.concept as string).slice(0, 5) };
}

/** Grade once; the reward (when anything was answered) comes with the grading request. */
async function grade(ctx: RequestContext, userId: number, r: ExamRow, now: Date, auto: boolean): Promise<Awaited<ReturnType<typeof onExamGraded>> | false> {
  const qs = await questions(ctx, r.id);
  for (const q of qs) q.isCorrect = q.answer !== null && sameAnswer(q.answer, q.correctAnswer);
  const score = qs.filter((q) => q.isCorrect).length;
  const used = Math.floor((Math.min(now.getTime(), new Date(r.deadline).getTime()) - new Date(r.startedAt).getTime()) / 1000);
  const won = await ctx.db.update(exams).set({
    status: "graded", submittedAt: stamp(now), score, accuracy: Math.round((score / Math.max(1, qs.length)) * 10_000) / 10_000,
    timeUsedS: Math.max(0, used), breakdownJson: JSON.stringify(breakdown(qs)), autoSubmitted: auto,
  }).where(and(eq(exams.id, r.id), eq(exams.status, "active"))).returning({ id: exams.id }).all();
  if (!won.length) return false;                                 // graded by another tab
  for (const q of qs) {
    await ctx.db.insert(examAnswers).values({ examId: r.id, idx: q.idx, answer: q.answer, flagged: false, correct: !!q.isCorrect, answeredAt: stamp(now) })
      .onConflictDoUpdate({ target: [examAnswers.examId, examAnswers.idx], set: { correct: !!q.isCorrect } });
    await mastery.record(ctx, userId, r.docHash, q.concept, !!q.isCorrect, {
      source: "exam", now, question: { question: q.question, correct_answer: q.correctAnswer, explanation: q.explanation },
    });
  }
  if (!qs.some((q) => q.answer !== null)) return null;
  const tz = (await ctx.db.select({ tz: userTable.timezone }).from(userTable).where(eq(userTable.id, userId)).get())?.tz ?? null;
  return onExamGraded(ctx, { id: userId, tz }, r.id, score / Math.max(1, qs.length), r.difficulty);
}

export async function submitExam(ctx: RequestContext, user: CurrentUser, id: string, now = new Date()) {
  const r = await row(ctx, user.id, id);
  const rewards = r.status === "active" ? await grade(ctx, user.id, r, now, overdue(r, now)) : null;
  return { ...(await getExam(ctx, user.id, id, now)), rewards: rewards || null };
}
