// Domain-level API functions. All HTTP goes through the typed client in ./api/client.ts
// (generated from the backend OpenAPI schema - run `npm run gen:api` after changing the API).
//
// Error handling is shared: failures throw an ApiError (code / message / action / details),
// a 401 sends the user to /login and a vanished document raises "cmai:document-gone" - see ./api/client.ts.
import { API_BASE_URL, api, rawApi } from "./api/client";
import { readPdf, type ReadPdf } from "./upload";
import type { components } from "./api/generated/schema";
import { ApiError, parseApiError } from "./api/errors";
import { idempotencyKey } from "./api/idempotency";

type QuestionType = components["schemas"]["QuizRequest"]["question_type"];

/** GET /auth/api-key: which AI provider the account has saved (never the key itself). */

/** One uploaded PDF as the server sees it (the server is the only source of truth for documents). */
export type DocumentInfo = components["schemas"]["DocumentOut"];
export type DocumentStatus = DocumentInfo["status"];
export type UploadResult = components["schemas"]["UploadResponse"];

export {
  ApiError,
  apiErrorMessage,
  parseApiError,
  type ApiErrorAction,
  type ApiErrorPayload,
} from "./api/errors";

// For code that needs the status itself (login form, "am I logged in?" probes, optional data):
// returns { data, error, response } and never throws on HTTP errors.
export { rawApi };

// Response bodies are handed back loosely typed, exactly as before: LLM output and service results
// carry more keys than the schema lists, so callers narrow them to their own view types.
// (Requests - paths, methods, bodies, query - are fully checked against the generated schema.)
function body(result: { data?: unknown }): any {
  return result.data;
}

/**
 * Start uploading a PDF (with a document id: replace that document). The browser reads the PDF first (pages and
 * fingerprint, lib/upload.ts); the server checks the plan and answers with the document (queued), or with the
 * document already there (`reused`). Then `sendUpload` (lib/upload.ts) sends the file and the pages.
 * Throws an ApiError with the server's message on failure (and "no_text" for a scanned PDF).
 */
export async function uploadPDF(file: File, sessionId?: string): Promise<UploadResult & { read: ReadPdf }> {
  const read = await readPdf(file);
  let res: Response;
  try {
    res = await fetch(new Request(`${API_BASE_URL}/upload`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, size: file.size, pages: read.pageCount, file_hash: read.hash, session_id: sessionId }),
    }));
  } catch {
    throw new ApiError(0, { code: "network", message: "Couldn't reach CourseMate. Check your connection and try again.", action: "retry", details: null });
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw parseApiError(res.status, body, `Upload failed with status ${res.status}`);
  return { ...(body as UploadResult), read };
}

/** All of the logged-in user's documents, most recently used first. */
export async function fetchDocuments(): Promise<DocumentInfo[]> {
  const { data } = await api.GET("/documents");
  return data!.documents;
}

/** One document's status, or null when the server no longer has it (expired, deleted, never uploaded). */
export async function fetchDocument(documentId: string): Promise<DocumentInfo | null> {
  try {
    const { data } = await api.GET("/documents/{document_id}", { params: { path: { document_id: documentId } } });
    return data!;
  } catch (err) {
    if (err instanceof ApiError && err.code === "document_not_found") return null;
    throw err;
  }
}

export async function chatQuestion(
  question: string,
  sessionId: string,
  topK: number = 5,
  history: { role: string; content: string }[] = [],
  signal?: AbortSignal,
) {
  const { data } = await api.POST("/chat", {
    body: { question, session_id: sessionId, history, top_k: topK },
    signal,
  });
  return body({ data });
}

// chatWithPDF removed — use chatQuestion() directly

export interface ReviewCard { front: string; back: string; explanation?: string | null; concept: string; topic?: string | null; difficulty?: string | null; source?: string; missed_at?: string }

/** Flashcards built by the server from questions this user got wrong on the document (arena + quizzes). No LLM. */
export async function fetchReviewDeck(sessionId: string): Promise<ReviewCard[]> {
  const { data } = await api.GET("/study/review-deck", { params: { query: { session_id: sessionId } } });
  return ((data as { cards?: ReviewCard[] } | undefined)?.cards) ?? [];
}

/** Tell the server how a flashcard went, so concept mastery (and the Nemesis boss) knows. With the card itself it
 *  also joins the spaced-repetition review queue (its first grade is its first review). Fire and forget. */
export function reviewFlashcard(sessionId: string, concept: string, correct: boolean,
                                card?: { front: string; back: string; explanation?: string | null }): void {
  if (!sessionId || !concept) return;
  const extra = card?.front && card?.back ? { front: card.front, back: card.back, explanation: card.explanation ?? null } : {};
  void api.POST("/study/flashcards/review", { body: { session_id: sessionId, concept, correct, ...extra } })
    .catch(() => { /* mastery is a bonus */ });
}

export async function generateFlashcards(topic: string, sessionId: string, numCards: number = 10) {
  const { data } = await api.POST("/flashcards", {
    body: { topic, session_id: sessionId, num_cards: numCards },
  });
  return body({ data });
}

export async function generateQuiz(topic: string, numQuestions: number, questionType: string, sessionId: string) {
  const { data } = await api.POST("/quiz", {
    // The server validates question_type and answers 422 for anything outside the schema's set.
    body: { topic, num_questions: numQuestions, question_type: questionType as QuestionType, session_id: sessionId },
  });
  return body({ data });
}

export async function generateNotes(topic: string, detailLevel: string, sessionId: string) {
  const { data } = await api.POST("/notes", {
    body: { topic, detail_level: detailLevel, session_id: sessionId },
  });
  return body({ data });
}

/** Grade one quiz answer on the server (instant feedback). The first answer to a question is final. */
export async function answerQuizQuestion(quizId: string, questionId: number, answer: string) {
  const { data } = await api.POST("/quiz/answer", {
    body: { quiz_id: quizId, question_id: questionId, answer },
  });
  return body({ data });
}

/** Finish a quiz: the server computes the accuracy and awards the rewards, once per quiz. */
export async function finishQuiz(quizId: string) {
  const { data } = await api.POST("/quiz/finish", { body: { quiz_id: quizId } });
  return body({ data });
}

export async function fetchHUD() {
  const { data } = await api.GET("/hud");
  return body({ data });
}

export async function fetchDailyQuests() {
  const { data } = await api.GET("/daily-quests");
  return body({ data });
}

export async function claimQuest(questType: string) {
  const { data } = await api.POST("/daily-quests/claim", { body: { quest_type: questType } });
  return body({ data });
}

export async function fetchShop() {
  const { data } = await api.GET("/shop");
  return body({ data });
}

export async function purchaseItem(itemId: string) {
  const once = idempotencyKey("shop-purchase", { item_id: itemId });
  const { data } = await api.POST("/shop/purchase", { body: { item_id: itemId }, headers: once.headers });
  once.done();
  return body({ data });
}

export async function equipItem(itemId: string) {
  const { data } = await api.POST("/shop/equip", { body: { item_id: itemId } });
  return body({ data });
}

export async function fetchHistory(mode?: string, limit: number = 100) {
  const { data } = await api.GET("/history", { params: { query: { mode, limit } } });
  return body({ data });
}

export async function fetchSessionHistory(sessionId: string) {
  const { data } = await api.GET("/history/session/{session_id}", {
    params: { path: { session_id: sessionId } },
  });
  return body({ data });
}

export async function fetchAchievements() {
  const { data } = await api.GET("/achievements");
  return body({ data });
}
