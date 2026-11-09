// The spaced-repetition review queue (backend routers/review.py, FSRS) and the plan entitlements.
import { API_BASE_URL, api, rawApi } from "@/lib/api/client";
import { parseApiError } from "@/lib/api/errors";
import type { components } from "@/lib/api/generated/schema";

export type ReviewItem = components["schemas"]["ReviewItem"];
export type ReviewStats = components["schemas"]["ReviewStats"];
export type Entitlements = components["schemas"]["EntitlementsResponse"];
export type Rating = 1 | 2 | 3 | 4;
export type Feature = "review_queue" | "exam_mode";

export const RATINGS: ReadonlyArray<{ rating: Rating; label: string; key: string; hint: string }> = [
  { rating: 1, label: "Again", key: "1", hint: "Forgot it" },
  { rating: 2, label: "Hard", key: "2", hint: "Got it, with effort" },
  { rating: 3, label: "Good", key: "3", hint: "Got it" },
  { rating: 4, label: "Easy", key: "4", hint: "Instant" },
];

export const SOURCE_LABEL: Record<string, string> = {
  flashcard: "Flashcard", arena: "Study scroll", quiz: "Quiz mistake", exam: "Exam mistake",
};

export async function fetchReviewQueue(opts: { sessionId?: string; limit?: number } = {}) {
  const { data } = await api.GET("/review/queue", {
    params: { query: { limit: opts.limit ?? 20, ...(opts.sessionId ? { session_id: opts.sessionId } : {}) } },
  });
  return data as components["schemas"]["ReviewQueueResponse"];
}

/** Grade a card. `reps` is the card as it was shown: a second grade of the same view is refused (409 review_stale). */
export async function gradeReview(item: Pick<ReviewItem, "id" | "reps">, rating: Rating, durationMs?: number) {
  const { data } = await api.POST("/review/grade", {
    body: { item_id: item.id, rating, reps: item.reps, ...(durationMs !== undefined ? { duration_ms: Math.round(durationMs) } : {}) },
  });
  return data as components["schemas"]["ReviewGradeResponse"];
}

export async function addToReview(sessionId: string, cards: { front: string; back: string; explanation?: string | null; concept?: string | null }[]) {
  const { data } = await api.POST("/review/cards", { body: { session_id: sessionId, cards } });
  return data as components["schemas"]["ReviewAddResponse"];
}

export async function removeFromReview(id: number) {
  await api.DELETE("/review/cards/{item_id}", { params: { path: { item_id: id } } });
}

/** Undo a remove (the route's POST; not in the generated schema). */
export async function restoreToReview(id: number) {
  const res = await fetch(`${API_BASE_URL}/review/cards/${encodeURIComponent(id)}`, { method: "POST", credentials: "same-origin" });
  if (!res.ok) throw parseApiError(res.status, await res.json().catch(() => null), "Couldn't put the card back");
}

/** The due count for the nav badge. Never throws (null when signed out or offline). */
export async function fetchReviewStats(): Promise<ReviewStats | null> {
  try {
    const { data, response } = await rawApi.GET("/review/stats");
    return response.ok && data ? (data as ReviewStats) : null;
  } catch { return null; }
}

export async function fetchEntitlements(): Promise<Entitlements | null> {
  try {
    const { data, response } = await rawApi.GET("/entitlements");
    return response.ok && data ? (data as Entitlements) : null;
  } catch { return null; }
}

/** "<1m", "10m", "5h", "4d", "3mo", "1.2y": how long until a card comes back. */
export function formatInterval(seconds: number): string {
  const m = seconds / 60, h = m / 60, d = h / 24;
  if (m < 1) return "<1m";
  if (h < 1) return `${Math.round(m)}m`;
  if (d < 1) return `${Math.round(h)}h`;
  if (d < 31) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  const y = d / 365;
  return `${y < 10 ? Math.round(y * 10) / 10 : Math.round(y)}y`;
}
