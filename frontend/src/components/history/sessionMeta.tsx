import { HelpCircle, Layers, MessageSquare, FileText } from "lucide-react";
import type { ReactNode } from "react";

/** The four kinds of saved study session: one icon and one label each (the same everywhere history is listed). */
export const MODE_META: Record<string, { icon: (size: number) => ReactNode; label: string }> = {
  chat:       { icon: (s) => <MessageSquare size={s} aria-hidden="true" />, label: "Chat" },
  quiz:       { icon: (s) => <HelpCircle size={s} aria-hidden="true" />,    label: "Quiz" },
  notes:      { icon: (s) => <FileText size={s} aria-hidden="true" />,      label: "Notes" },
  flashcards: { icon: (s) => <Layers size={s} aria-hidden="true" />,        label: "Flashcards" },
};

export const modeMeta = (type: string) => MODE_META[type] ?? MODE_META.chat;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * A date a person can place at a glance: "Today, 8:11 PM", "Yesterday, 8:11 PM", "Oct 12, 8:11 PM" (and the year
 * when it is not this one). `full` is the unabbreviated form for a tooltip.
 */
/** Dates are written the same way everywhere ("Sep 2, 9:00 AM"), whatever the machine's regional settings: the UI is
 * English, and a list should not change shape between a laptop in Delhi and one in Denver. */
const LOCALE = "en-US";

export function formatWhen(iso: string, now: Date = new Date()): { text: string; full: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { text: "Unknown date", full: "Unknown date" };
  const time = date.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const day = sameDay(date, now) ? "Today"
    : sameDay(date, yesterday) ? "Yesterday"
    : date.toLocaleDateString(LOCALE, date.getFullYear() === now.getFullYear()
        ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return { text: `${day}, ${time}`, full: date.toLocaleString(LOCALE, { dateStyle: "full", timeStyle: "short" }) };
}
