// What the study tools pay out (Stage 4.5; the bookkeeping that used to sit in backend/routers/study.py, review.py
// and services/exam_service.py). A failure here never fails the study action itself: the answer was already given.
import type { RequestContext } from "../context";
import { award, bumpQuest, markActive, questsOnAction, updateStreak } from "./progression";
import { incrementProgress, localDate, type Player } from "./store";

type Reward = Awaited<ReturnType<typeof award>> | null;

async function safely<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch (e) { console.warn(`[coursemate-game] ${what} failed`, e instanceof Error ? e.message : e); return null; }
}

/** A real chat question: counts for the "ask questions" quest; every 5th answered one pays a bundle. */
export function onChatAnswered(ctx: RequestContext, p: Player, question: string, clarifying: boolean): Promise<Reward> {
  return safely("chat reward", async () => {
    const q = question.trim();
    if (q.length < 3 || !/\p{L}/u.test(q)) return null;
    await markActive(ctx, p);
    await questsOnAction(ctx, p, "chat_question");
    if (clarifying) return null;
    const total = await incrementProgress(ctx, p.id, "totalChatQuestions");
    return total % 5 === 0 ? award(ctx, p, "chat_bundle_5") : null;
  });
}

export const onFlashcards = (ctx: RequestContext, p: Player) => safely("flashcards reward", () => award(ctx, p, "flashcard_complete"));
export const onNotes = (ctx: RequestContext, p: Player) => safely("notes reward", () => award(ctx, p, "notes_generation"));
export const onQuizStarted = (ctx: RequestContext, p: Player) => safely("quiz start", async () => { await markActive(ctx, p); return null; });

export const onQuizFinished = (ctx: RequestContext, p: Player, quizId: string, accuracy: number) =>
  safely("quiz reward", () => award(ctx, p, "quiz_complete", { accuracy, difficulty: 1.2, sourceId: quizId }));

const EXAM_DIFFICULTY: Record<string, number> = { easy: 1, medium: 1.25, hard: 1.5, mixed: 1.25 };
export const onExamGraded = (ctx: RequestContext, p: Player, examId: string, accuracy: number, difficulty: string) =>
  safely("exam reward", () => award(ctx, p, "exam_complete", { accuracy, difficulty: EXAM_DIFFICULTY[difficulty] ?? 1, sourceId: `exam:${examId}` }));

/** A graded review card: streak and quests; clearing the queue (once a day) pays review_complete. */
export function onReviewGraded(ctx: RequestContext, p: Player, stats: { due: number; reviewed_today: number }): Promise<Reward> {
  return safely("review reward", async () => {
    await updateStreak(ctx, p);
    await markActive(ctx, p);
    await bumpQuest(ctx, p, "review_cards");
    if (stats.due !== 0 || stats.reviewed_today <= 0) return null;
    const r = await award(ctx, p, "review_complete", { sourceId: `review:${localDate(p.tz)}` });
    return r && r.ok ? r : null;
  });
}

