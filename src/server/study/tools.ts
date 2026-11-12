// Quizzes, flashcards and notes on the Worker (Stage 4.4; the flows of backend/routers/study.py).
//   quiz        the topic must be in the document; questions this user hasn't had from their bank for this
//               document and topic first (no AI call), else a fresh batch, which joins the bank. Correct answers stay
//               on the server: /quiz/answer grades one question (first answer final), /quiz/finish scores it once.
//   flashcards  and notes are cached for the same request (GENERATION_CACHE_DAYS).
// XP, coins and quests (`rewards`) come back with the game in 4.5.
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { CurrentUser, RequestContext } from "../context";
import { quizAnswers, quizBank, quizzes } from "../db/schema";
import { notFound, studyDocs } from "./documents";
import { HttpError } from "../http";
import { generate, type Caller } from "../ai/run";
import { callerFor } from "../chat";
import { cacheGet, cacheKey, cachePut, findTopic, generateData, generationFailed, logActivity } from "./core";
import * as mastery from "./mastery";
import { gradeFirst } from "./review";
import { BadAnswer, flashcardSet, mergeQuestions, quizBatch, type QuizQuestion } from "./schemas";
import { flashcardSystem, noteFormatFrom, notesMessages, QUIZ_CHECK_SYSTEM, quizCheckPrompt, quizHuman, quizSystem } from "./prompts";
import { toRetrieval } from "../chat";
import type { Found } from "./core";
import { cleanText, newId, questionKey, sameAnswer, stamp, validateTopic } from "./text";
import { onFlashcards, onNotes, onQuizFinished, onQuizStarted } from "../game/hooks";

const player = (u: CurrentUser) => ({ id: u.id, tz: u.row.timezone ?? null });

export const QUESTION_TYPES = ["MCQ", "True/False", "Mixed"] as const;
export const DIFFICULTIES = ["easy", "medium", "hard", "mixed"] as const;
const BATCH_SIZE = 5;
const MAX_BATCHES = 6;
const MAX_CONCURRENT = 3;
const MAX_BANK_PER_TOPIC = 400;

type Body = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

function topK(v: unknown): number {
  if (v === undefined || v === null) return 5;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 20) throw new HttpError(400, "invalid_input", "top_k must be between 1 and 20");
  return v;
}

/** Run `jobs` at most `limit` at a time; each settles on its own. */
async function settleAll<T>(jobs: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++;
      try { out[i] = { status: "fulfilled", value: await jobs[i]() }; } catch (reason) { out[i] = { status: "rejected", reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, lane));
  return out;
}

/** The first failure worth showing as it is (a plan limit, the AI being unavailable), else a generic one. */
function firstReal(results: PromiseSettledResult<unknown>[], message: string): HttpError {
  for (const r of results) if (r.status === "rejected" && r.reason instanceof HttpError) return r.reason;
  return generationFailed(message);
}

// ── quiz ─────────────────────────────────────────────────────────────────────────────────────────────────────
const passageLabel = (p: Found["passages"][number]) => (p.documentName && p.page ? `${p.documentName} · p.${p.page}` : p.documentName || (p.page ? `p.${p.page}` : ""));
/** The passages numbered, so a question can say which one its answer comes from. */
export function numberedPassages(found: Pick<Found, "passages">, maxChars = 12_000): string {
  let out = "";
  found.passages.forEach((p, i) => {
    const block = `[${i + 1}] (${passageLabel(p)})\n${p.text}\n\n`;
    if (out.length + block.length <= maxChars) out += block;
  });
  return out.trim();
}

/**
 * Round 7, the second pass: another call answers every question from the passages alone. A question whose key it
 * disagrees with, or that it finds unsupported or ambiguous, is dropped. If the check itself fails, the questions
 * stand (they were written from the same passages).
 */
export async function checkQuiz(ctx: RequestContext, caller: Caller, questions: QuizQuestion[], context: string): Promise<{ kept: QuizQuestion[]; dropped: number; checked: boolean }> {
  if (!questions.length) return { kept: questions, dropped: 0, checked: false };
  const asked = questions.map((q, i) => ({ id: i + 1, question: q.question, options: q.options }));
  type Verdict = { id: number; answer: string; supported: boolean };
  let verdicts: Verdict[];
  try {
    verdicts = await generateData(ctx, caller, "strong", [{ role: "system", content: QUIZ_CHECK_SYSTEM }, { role: "user", content: quizCheckPrompt(asked, context) }], (d) => {
      const list = Array.isArray((d as { results?: unknown })?.results) ? (d as { results: unknown[] }).results : [];
      const out = list.flatMap((r) => {
        const o = r as Record<string, unknown>;
        const id = Number(o?.id);
        return Number.isInteger(id) ? [{ id, answer: String(o.answer ?? ""), supported: o.supported !== false }] : [];
      });
      if (!out.length) throw new BadAnswer("no verdicts");
      return out;
    }, { temperature: 0, attempts: 1 });
  } catch (e) {
    if (e instanceof HttpError && (e.code === "plan_limit" || e.status === 429)) throw e;     // out of AI calls: say so
    return { kept: questions, dropped: 0, checked: false };
  }
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const kept = questions.filter((q, i) => {
    const v = byId.get(i + 1);
    if (!v) return true;                                      // not checked: keep
    return v.supported && sameAnswer(q.options.find((o) => sameAnswer(o, v.answer)) ?? v.answer, q.correct_answer);
  });
  return { kept, dropped: questions.length - kept.length, checked: true };
}

/**
 * Up to `n` questions rounded up to whole batches (a 3-question quiz asks for 5): the spares go to the bank, so a
 * later quiz on the topic may need no AI call at all. Batches run in parallel; a failed one is skipped. Each
 * question remembers where its answer is ("Bio.pdf · p.2"), then the whole set is checked (checkQuiz).
 */
export async function writeQuiz(ctx: RequestContext, caller: Caller, found: Pick<Found, "passages">, n: number, type: string, difficulty = "mixed"): Promise<QuizQuestion[]> {
  const sizes: number[] = [];
  const want = Math.min(Math.ceil(n / BATCH_SIZE) * BATCH_SIZE, BATCH_SIZE * MAX_BATCHES);
  for (let left = want; left > 0 && sizes.length < MAX_BATCHES; left -= sizes.at(-1)!) sizes.push(Math.min(left, BATCH_SIZE));
  const system = quizSystem(type);
  const context = numberedPassages(found);
  const results = await settleAll(sizes.map((size) => () => generateData(ctx, caller, "strong",
    [{ role: "system", content: system }, { role: "user", content: quizHuman(size, type, context, difficulty) }],
    (d) => quizBatch(d, type), { temperature: 0.7, attempts: 1 })), MAX_CONCURRENT);
  const all = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  if (!all.length) throw firstReal(results, "Quiz generation failed. Please try again.");
  const labelled = mergeQuestions(all, want).map(({ id: _id, ...q }) => {
    const p = q.source ? found.passages[q.source - 1] : undefined;
    return p ? { ...q, source_label: passageLabel(p) } : q;
  });
  const { kept } = await checkQuiz(ctx, caller, labelled, context);
  if (!kept.length) throw generationFailed("The questions written for this topic didn't hold up against your PDF. Try a narrower topic.");
  return kept;
}

/** Multiple-choice options in a fresh order (models put the right answer first far too often). */
export function shuffleOptions<T extends QuizQuestion>(q: T, rand: () => number = Math.random): T {
  if (q.options.length < 3) return q;                          // True/False stays True, False
  const options = [...q.options];
  for (let i = options.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [options[i], options[j]] = [options[j], options[i]]; }
  return { ...q, options };
}

const topicKey = (t: string) => questionKey(t);

async function takeFromBank(ctx: RequestContext, userId: number, docHash: string, topic: string, type: string, n: number): Promise<QuizQuestion[] | null> {
  const rows = await ctx.db.select({ id: quizBank.id, q: quizBank.questionJson }).from(quizBank).where(and(
    eq(quizBank.userId, userId), eq(quizBank.docHash, docHash), eq(quizBank.topicKey, topicKey(topic)),
    eq(quizBank.questionType, type), eq(quizBank.served, false))).orderBy(quizBank.id).all();
  if (rows.length < n) return null;
  const picked = [...rows].sort(() => Math.random() - 0.5).slice(0, n).sort((a, b) => a.id - b.id);
  for (const r of picked) await ctx.db.update(quizBank).set({ served: true }).where(eq(quizBank.id, r.id));
  return picked.map((r) => JSON.parse(r.q) as QuizQuestion);
}

/** Keep a written batch: the first `served` were given out now, the rest wait for a later quiz. */
async function addToBank(ctx: RequestContext, userId: number, docHash: string, topic: string, type: string, questions: QuizQuestion[], served: number) {
  const tk = topicKey(topic);
  const have = (await ctx.db.select({ n: count() }).from(quizBank).where(and(eq(quizBank.userId, userId), eq(quizBank.docHash, docHash),
    eq(quizBank.topicKey, tk), eq(quizBank.questionType, type))).get())?.n ?? 0;
  const room = Math.max(0, MAX_BANK_PER_TOPIC - have);
  const rows = questions.slice(0, room).map((q, i) => {
    const { id: _id, ...body } = q as QuizQuestion & { id?: number };
    return { userId, docHash, topicKey: tk, questionType: type, textKey: questionKey(q.question), questionJson: JSON.stringify(body), served: i < served, createdAt: stamp() };
  }).filter((r) => r.textKey);
  for (const r of rows) await ctx.db.insert(quizBank).values(r).onConflictDoNothing();
}

const SECRET = ["correct_answer", "explanation", "source", "source_label"];
const publicQuestion = (q: Record<string, unknown>) => Object.fromEntries(Object.entries(q).filter(([k]) => !SECRET.includes(k)));

export async function createQuiz(ctx: RequestContext, user: CurrentUser, body: Body) {
  const k = topK(body.top_k);
  const topic = validateTopic(body.topic);
  const type = str(body.question_type);
  if (!(QUESTION_TYPES as readonly string[]).includes(type)) throw new HttpError(422, "validation_error", "Some of the information you entered is invalid.", null, { field: "question_type" });
  let n = Number(body.num_questions);
  n = !Number.isFinite(n) || n < 1 ? 3 : Math.min(20, Math.trunc(n));
  const difficulty = (DIFFICULTIES as readonly string[]).includes(str(body.difficulty)) ? str(body.difficulty) : "mixed";
  // the bank keeps each difficulty apart ("MCQ" is the mixed one, as before)
  const bankType = difficulty === "mixed" ? type : `${type}|${difficulty}`;
  const study = await studyDocs(ctx, user, str(body.session_id));
  await logActivity(ctx, user.id, study.id, "quiz", "generate", { topic, num_questions: n, question_type: type, difficulty });
  const found = await findTopic(ctx, study.docs, topic, k, 50);
  let questions = await takeFromBank(ctx, user.id, study.hash, topic, bankType, n);
  if (!questions) {
    const written = await writeQuiz(ctx, await callerFor(ctx, user), found, n, type, difficulty);
    questions = written.slice(0, n);
    await addToBank(ctx, user.id, study.hash, topic, bankType, written, questions.length);
  }
  const stored = questions.map((q, i) => ({ ...shuffleOptions(q), id: i + 1 }));
  const id = newId();
  await ctx.db.insert(quizzes).values({
    id, userId: user.id, sessionId: study.id, topic, questionType: type, questionsJson: JSON.stringify(stored),
    questionCount: stored.length, createdAt: stamp(),
  });
  await onQuizStarted(ctx, player(user));
  return { mode: "quiz", quiz_id: id, content: { questions: stored.map(publicQuestion) }, sources: found.sources };
}

async function ownQuiz(ctx: RequestContext, userId: number, quizId: unknown) {
  const row = typeof quizId === "string" && quizId
    ? await ctx.db.select().from(quizzes).where(and(eq(quizzes.id, quizId), eq(quizzes.userId, userId))).get() : undefined;
  if (!row) throw new HttpError(404, "quiz_not_found", "We couldn't find that quiz. Please generate a new one.");
  return { ...row, questions: JSON.parse(row.questionsJson) as (QuizQuestion & { id: number })[] };
}

const correctOption = (q: QuizQuestion) => q.options.find((o) => sameAnswer(o, q.correct_answer)) ?? q.correct_answer;

export async function answerQuiz(ctx: RequestContext, user: CurrentUser, body: Body) {
  const quiz = await ownQuiz(ctx, user.id, body.quiz_id);
  const q = quiz.questions.find((x) => x.id === Number(body.question_id));
  if (!q) throw new HttpError(404, "question_not_found", "That question isn't part of this quiz.");
  const picked = q.options.find((o) => sameAnswer(o, body.answer));
  if (picked === undefined) throw new HttpError(400, "invalid_answer", "Pick one of the answer options.");
  const correct = sameAnswer(picked, q.correct_answer);
  const first = await ctx.db.insert(quizAnswers).values({ quizId: quiz.id, questionId: q.id, answer: picked, correct, answeredAt: stamp() })
    .onConflictDoNothing().returning({ id: quizAnswers.questionId }).all();
  if (first.length) {
    const hash = await mastery.docHashFor(ctx, user.id, quiz.sessionId);
    if (hash) {
      await mastery.record(ctx, user.id, hash, q.concept || quiz.topic, correct, {
        source: "quiz", question: { question: q.question, correct_answer: correctOption(q), explanation: q.explanation },
      });
    }
  }
  const stored = await ctx.db.select().from(quizAnswers).where(and(eq(quizAnswers.quizId, quiz.id), eq(quizAnswers.questionId, q.id))).get();
  return { ok: true, question_id: q.id, answer: stored!.answer, correct: stored!.correct, correct_answer: correctOption(q), explanation: q.explanation || null,
    source: q.source_label ?? null, concept: q.concept ?? null };
}

export async function finishQuiz(ctx: RequestContext, user: CurrentUser, body: Body) {
  const quiz = await ownQuiz(ctx, user.id, body.quiz_id);
  const result = (q: typeof quiz, already: boolean) => ({
    ok: true, quiz_id: q.id, score: q.correctCount ?? 0, total: q.questionCount, accuracy: q.accuracy ?? 0, already_finished: already, rewards: null,
  });
  if (quiz.finishedAt) return { ...result(quiz, true), ...(await missedOf(ctx, quiz)) };
  const r = await ctx.db.select({ answered: count(), correct: sql<number>`COALESCE(SUM(${quizAnswers.correct}), 0)` }).from(quizAnswers).where(eq(quizAnswers.quizId, quiz.id)).get();
  const answered = Number(r?.answered ?? 0), correct = Number(r?.correct ?? 0);
  if (answered < quiz.questionCount) {
    throw new HttpError(400, "quiz_incomplete", "Answer every question before finishing the quiz.", null, { answered, total: quiz.questionCount });
  }
  const accuracy = correct / Math.max(quiz.questionCount, 1);
  const won = await ctx.db.update(quizzes).set({ finishedAt: stamp(), correctCount: correct, accuracy })
    .where(and(eq(quizzes.id, quiz.id), isNull(quizzes.finishedAt))).returning({ id: quizzes.id }).all();
  if (!won.length) return result(await ownQuiz(ctx, user.id, quiz.id), true);
  const rewards = await onQuizFinished(ctx, player(user), quiz.id, accuracy);
  return { ok: true, quiz_id: quiz.id, score: correct, total: quiz.questionCount, accuracy, already_finished: false, rewards, ...(await missedOf(ctx, quiz)) };
}

/** What was missed: those questions went to the review queue, and their ideas are the weak spots. */
async function missedOf(ctx: RequestContext, quiz: Awaited<ReturnType<typeof ownQuiz>>) {
  const wrong = await ctx.db.select({ id: quizAnswers.questionId }).from(quizAnswers).where(and(eq(quizAnswers.quizId, quiz.id), eq(quizAnswers.correct, false))).all();
  const missed = quiz.questions.filter((q) => wrong.some((w) => w.id === q.id));
  return {
    missed: missed.map((q) => q.id),
    added_to_review: missed.length,
    weak_concepts: [...new Set(missed.map((q) => q.concept || quiz.topic))].slice(0, 5),
  };
}

/** "Retry the ones I missed": a new quiz of a finished quiz's wrong answers, options in a new order. No AI call. */
export async function retryQuiz(ctx: RequestContext, user: CurrentUser, body: Body) {
  const quiz = await ownQuiz(ctx, user.id, body.quiz_id);
  if (!quiz.finishedAt) throw new HttpError(400, "quiz_incomplete", "Finish the quiz first, then retry the questions you missed.");
  const { missed } = await missedOf(ctx, quiz);
  if (!missed.length) throw new HttpError(400, "nothing_missed", "You got every question right: nothing to retry.");
  const stored = quiz.questions.filter((q) => missed.includes(q.id)).map((q, i) => ({ ...shuffleOptions(q), id: i + 1 }));
  const id = newId();
  const topic = quiz.topic.endsWith(" (retry)") ? quiz.topic : `${quiz.topic} (retry)`;
  await ctx.db.insert(quizzes).values({
    id, userId: user.id, sessionId: quiz.sessionId, topic, questionType: quiz.questionType, questionsJson: JSON.stringify(stored),
    questionCount: stored.length, createdAt: stamp(),
  });
  await logActivity(ctx, user.id, quiz.sessionId, "quiz", "generate", { topic, num_questions: stored.length, question_type: quiz.questionType, retry_of: quiz.id });
  return { mode: "quiz", quiz_id: id, topic, content: { questions: stored.map(publicQuestion) }, sources: [] };
}

// ── flashcards ───────────────────────────────────────────────────────────────────────────────────────────────
export async function makeFlashcards(ctx: RequestContext, user: CurrentUser, body: Body) {
  const topic = validateTopic(body.topic);
  const n = Math.max(1, Math.min(Math.trunc(Number(body.num_cards ?? 10)) || 10, 30));
  const study = await studyDocs(ctx, user, str(body.session_id));
  const key = cacheKey("flashcards", user.id, study.hash, topic, { num_cards: n });
  let result = await cacheGet<{ cards: unknown[]; total: number; topic: string }>(ctx, key);
  if (!result) {
    const found = await findTopic(ctx, study.docs, topic, 12);
    const cards = await generateData(ctx, await callerFor(ctx, user), "strong", [
      { role: "system", content: flashcardSystem(n + 3) },
      { role: "user", content: `Topic: ${topic}\n\nContent:\n${found.context.slice(0, 5000)}` },
    ], flashcardSet, { temperature: 0.7 }).catch((e) => { throw e instanceof HttpError ? e : generationFailed("Flashcard generation failed. Please try again."); });
    const deck = cards.slice(0, n).map((c, i) => ({ id: i + 1, ...c }));
    result = { cards: deck, total: deck.length, topic };
    await cachePut(ctx, user.id, key, result);
  }
  await logActivity(ctx, user.id, study.id, "flashcards", "generate", { topic });
  return { ...result, rewards: await onFlashcards(ctx, player(user)) };
}

/** "I knew it" / "I didn't": counts for the concept; with front and back the card joins the review queue. */
export async function flashcardReview(ctx: RequestContext, user: CurrentUser, body: Body) {
  const concept = str(body.concept).split(/\s+/).filter(Boolean).join(" ");
  if (!concept || concept.length > 200) throw new HttpError(400, "invalid_input", "Concept must be 1-200 characters.");
  if (typeof body.correct !== "boolean") throw new HttpError(422, "validation_error", "Some of the information you entered is invalid.", null, { field: "correct" });
  const hash = await mastery.docHashFor(ctx, user.id, str(body.session_id));
  if (!hash) throw notFound();
  const row = await mastery.record(ctx, user.id, hash, concept, body.correct);
  const item = body.front && body.back
    ? await gradeFirst(ctx, user.id, hash, { front: body.front, back: body.back, explanation: body.explanation, concept }, body.correct)
    : null;
  return { ok: true, concept, mastery: row, review_item: item };
}

export async function reviewDeck(ctx: RequestContext, user: CurrentUser, sessionId: string, limit: number) {
  const hash = await mastery.docHashFor(ctx, user.id, sessionId);
  if (!hash) throw notFound();
  const cards = await mastery.reviewDeck(ctx, user.id, hash, Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 100)));
  return { ok: true, cards, total: cards.length };
}

// ── notes ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Notes in a format the student picks (round 7): summary, detailed (exam-ready), Cornell, outline, key terms or a
 * cheat sheet. Written from numbered passages, so every point carries its [n] and the page opens beside the notes.
 * (`detail_level` from older clients still works: "Ultra-detailed" is the detailed format.)
 */
export async function makeNotes(ctx: RequestContext, user: CurrentUser, body: Body) {
  const k = Math.max(topK(body.top_k), 8);                     // a page of notes needs more than a chat answer
  const topic = validateTopic(body.topic);
  const detail = cleanText(body.detail_level, 60);
  const format = noteFormatFrom(body.format, detail);
  const study = await studyDocs(ctx, user, str(body.session_id));
  await logActivity(ctx, user.id, study.id, "notes", "generate", { topic, format });
  const key = cacheKey("notes", user.id, study.hash, topic, { top_k: k, format });
  type Cached = { content: string; sources: string[]; citations?: unknown[] };
  let cached = await cacheGet<Cached>(ctx, key);
  if (!cached) {
    const found = await findTopic(ctx, study.docs, topic, k, 50);
    const r = toRetrieval(found.passages);
    const context = r.citations.map((c) => `[${c.n}] (${c.label})\n${r.passages[c.n - 1].text}`).join("\n\n");
    const { text } = await generate(ctx, await callerFor(ctx, user), "strong", notesMessages(format, context), { temperature: 0.4, maxOutputTokens: 6000 })
      .catch((e) => { throw e instanceof HttpError ? e : generationFailed("Notes generation failed. Please try again."); });
    cached = { content: text.trim(), sources: r.sources, citations: r.citations };
    await cachePut(ctx, user.id, key, cached);
  }
  return { mode: "notes", format, content: cached.content, sources: cached.sources, citations: cached.citations ?? [], rewards: await onNotes(ctx, player(user)) };
}
