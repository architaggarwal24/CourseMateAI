// The Today page's numbers, from what the app already has: the review queue's stats, the saved sessions in this
// browser and the daily quests. Pure functions, so the page stays a thin view.
import type { ReviewStats } from "@/lib/study/review";

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  return "Good evening";
}

/** Seconds a card takes, on average, for the "about N min left" estimate. */
const SECONDS_PER_CARD = 15;

export interface ReviewProgress { locked: boolean; due: number; done: number; total: number; pct: number; minutes: number }

/** Due now, done today, and how far through today's cards that is (the goal-gradient bar). */
export function reviewProgress(stats: Pick<ReviewStats, "due" | "reviewed_today" | "locked"> | null): ReviewProgress {
  const due = stats?.due ?? 0;
  const done = stats?.reviewed_today ?? 0;
  const total = due + done;
  return {
    locked: !!stats?.locked,
    due, done, total,
    pct: total === 0 ? 100 : Math.round((done / total) * 100),
    minutes: Math.ceil((due * SECONDS_PER_CARD) / 60),
  };
}

const LABELS: Record<string, string> = { chat: "Chat", quiz: "Quiz", notes: "Notes", flashcards: "Flashcards" };

export interface LastSession { id: string; type: string; label: string; preview: string; title?: string }

/** The most recently saved study session (chat, quiz, notes or flashcards) in this browser. */
export function lastSession(meta: Record<string, { type: string; preview: string; updated: string; title?: string }>): LastSession | null {
  const entries = Object.entries(meta).filter(([, m]) => m.type in LABELS)
    .sort((a, b) => new Date(b[1].updated).getTime() - new Date(a[1].updated).getTime());
  if (!entries.length) return null;
  const [id, m] = entries[0];
  return { id, type: m.type, label: LABELS[m.type], preview: m.preview, ...(m.title ? { title: m.title } : {}) };
}

const WORDS = ["No", "One", "Two"];

/** One line: how many things are left today, and what they are. */
export function todaySummary({ due, questsLeft }: { due: number; questsLeft: number }): string {
  const parts = [due > 0 && "your review", questsLeft > 0 && `${questsLeft} ${questsLeft === 1 ? "quest" : "quests"}`].filter(Boolean) as string[];
  if (!parts.length) return "You're all caught up today.";
  return `${WORDS[parts.length]} ${parts.length === 1 ? "thing" : "things"} left today: ${parts.join(" and ")}.`;
}
