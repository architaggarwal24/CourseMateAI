// Study's focus mode (the two worlds, Stage 6): the Pomodoro rhythm, and telling the server a session was finished.
import { API_BASE_URL, throwForResponse } from "@/lib/api/client";

/** 25 minutes of focus, then 5 of rest. */
export const FOCUS_MS = 25 * 60 * 1000, BREAK_MS = 5 * 60 * 1000;

export interface FocusSessionResult { ok: boolean; counted: boolean; capped: boolean; sessions_today: number; xp?: number; insight: number }

/** A focus session finished: +20 Insight and a little XP (four a day). */
export async function postFocusSession(): Promise<FocusSessionResult> {
  const res = await fetch(`${API_BASE_URL}/focus-session`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
  if (!res.ok) await throwForResponse(res);
  return (await res.json()) as FocusSessionResult;
}

/** mm:ss for a number of milliseconds. */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
