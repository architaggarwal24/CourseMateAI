// The quest board's shapes and links (Stage Q1; server: src/server/game/scrolls.ts). Every quest is a scroll; "Answer
// the call" opens the place it is done.
import { API_BASE_URL, throwForResponse } from "@/lib/api/client";
import { ROUTES } from "@/lib/routes";

export type ScrollKind = "daily" | "weekly" | "hunt" | "story";
export interface Call { place: string; topic?: string }
export interface Scroll {
  id: string; kind: ScrollKind; title: string; text: string; target: number; progress: number;
  completed: boolean; claimed: boolean; reward: { xp: number; coins: number }; call: Call;
  /** A hunt: the creature whose lost page it finds. */
  lost_page?: string;
}
export interface Board {
  week: string;
  weekly: Scroll[];
  hunts: Scroll[];
  story: { champion: string; chapters_done: number; chapters: number; scroll: Scroll | null };
}
export interface ClaimResult {
  ok: boolean; id: string; kind: ScrollKind; reward: { xp: number; coins: number }; lost_page: string | null;
  totals: { total_xp: number; coins: number; level: number };
}

/** Where each daily quest is done. */
export const DAILY_CALL: Record<string, Call> = {
  ask_questions: { place: "chat" }, ask_deep_questions: { place: "chat" },
  complete_quizzes: { place: "quiz" }, perfect_quiz: { place: "quiz" }, quiz_master: { place: "quiz" }, quiz_perfectionist: { place: "quiz" },
  review_cards: { place: "review" }, clear_reviews: { place: "review" },
  generate_notes: { place: "notes" }, notes_scholar: { place: "notes" },
  study_flashcards: { place: "flashcards" }, complete_exams: { place: "exam" },
  arena_rounds: { place: "arena" }, defeat_boss: { place: "arena" }, boss_hunter: { place: "arena" },
  maintain_streak: { place: "today" },
};

/** The link behind "Answer the call". */
export function callHref(call: Call | undefined): string {
  switch (call?.place) {
    case "arena": return call.topic ? `${ROUTES.heroArena}&topic=${encodeURIComponent(call.topic)}` : ROUTES.heroArena;
    case "chat": case "quiz": case "review": case "notes": case "flashcards": case "exam": return ROUTES.studyTab(call.place);
    case "bestiary": return ROUTES.heroTab("bestiary");
    default: return ROUTES.today;
  }
}

/** A daily quest (GET /hud's shape) as a scroll. */
export function dailyScroll(q: { quest_type: string; description: string; target_count: number; current_count: number; reward_xp: number; reward_coins: number; completed: boolean | number; claimed: boolean | number }): Scroll {
  return {
    id: `daily:${q.quest_type}`, kind: "daily", title: q.description, text: "", target: q.target_count || 1,
    progress: Math.min(q.current_count || 0, q.target_count || 1), completed: q.completed === true || q.completed === 1,
    claimed: q.claimed === true || q.claimed === 1, reward: { xp: q.reward_xp, coins: q.reward_coins }, call: DAILY_CALL[q.quest_type] ?? { place: "today" },
  };
}

// the player's week follows their time zone (the server reads it from x-timezone, as for every game call)
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } };
const headers = (): Record<string, string> => (zone() ? { "x-timezone": zone() } : {});

export async function fetchBoard(): Promise<Board> {
  const res = await fetch(`${API_BASE_URL}/quests`, { credentials: "include", headers: headers() });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as Board;
}

export async function claimScroll(id: string): Promise<ClaimResult> {
  const res = await fetch(`${API_BASE_URL}/quests/claim`, {
    method: "POST", credentials: "include", headers: { ...headers(), "content-type": "application/json" }, body: JSON.stringify({ id }),
  });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as ClaimResult;
}
