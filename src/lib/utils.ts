import { clsx, type ClassValue } from "clsx";
// FIX BUG-F07: tailwind-merge is now a declared dependency in package.json.
// Import directly instead of using a try/catch require guard.
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes, resolving conflicts correctly.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize answer for comparison (case-insensitive, trim whitespace)
 */
export function normalizeAnswer(answer: string): string {
  if (!answer) return "";
  return answer.trim().toLowerCase();
}

/**
 * Calculate reading time based on word count
 */
export function calculateReadingTime(text: string, wpm: number = 200): number {
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / wpm));
}

/**
 * Format date to relative time
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}