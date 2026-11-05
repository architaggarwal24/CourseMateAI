// Exam mode (backend routers/exams.py): a timed mock test from a document, graded on the server.
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/generated/schema";

export type Exam = components["schemas"]["Exam"];
export type ExamQuestion = components["schemas"]["ExamQuestion"];
export type ExamResult = components["schemas"]["ExamResult"];
export type ExamOptions = components["schemas"]["ExamOptionsResponse"];
export type ExamDifficulty = "easy" | "medium" | "hard" | "mixed";
export type ExamSummary = {
  id: string; status: string; doc_name: string; session_id: string; length: number; difficulty: string;
  started_at: string; submitted_at: string | null; score: number | null; total: number; accuracy: number | null;
};

export const DIFFICULTY_LABEL: Record<ExamDifficulty, string> = { easy: "Easy", medium: "Medium", hard: "Hard", mixed: "Mixed" };

export async function fetchExamOptions(sessionId: string) {
  const { data } = await api.GET("/exams/options", { params: { query: { session_id: sessionId } } });
  return data as ExamOptions;
}

export async function startExam(sessionId: string, length: number, difficulty: ExamDifficulty, topics: string[]) {
  const { data } = await api.POST("/exams", { body: { session_id: sessionId, length: length as 10 | 20 | 30, difficulty, topics } });
  return data as Exam;
}

export async function fetchActiveExam(): Promise<Exam | null> {
  const { data } = await api.GET("/exams/active");
  return ((data as { exam?: Exam | null } | undefined)?.exam) ?? null;
}

export async function fetchExam(id: string) {
  const { data } = await api.GET("/exams/{exam_id}", { params: { path: { exam_id: id } } });
  return data as Exam;
}

export async function fetchExamHistory(): Promise<ExamSummary[]> {
  const { data } = await api.GET("/exams", { params: { query: { limit: 10 } } });
  return ((data as { exams?: ExamSummary[] } | undefined)?.exams) ?? [];
}

export async function saveExamAnswer(id: string, index: number, change: { answer?: string; clear?: boolean; flagged?: boolean }) {
  const { data } = await api.POST("/exams/{exam_id}/answers", { params: { path: { exam_id: id } }, body: { index, ...change } });
  return data as components["schemas"]["ExamAnswerResponse"];
}

export async function submitExam(id: string) {
  const { data } = await api.POST("/exams/{exam_id}/submit", { params: { path: { exam_id: id } } });
  return data as Exam;
}

/** The PDF score report (a plain link: the browser downloads it with the login cookie). */

/** m:ss (or h:mm:ss) for the exam clock. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
