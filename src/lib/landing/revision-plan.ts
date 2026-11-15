// The revision planner's plan (the free tool at /tools/revision-planner), worked out in the browser: each chapter gets
// a study day, comes back for review 1, 3 and 7 days later (spaced repetition), and the last days before the exam
// (a week, or fewer when time is short) are for mock tests and revising the weakest chapters.

export interface PlanDay { date: string; study: string[]; review: string[]; mock: boolean }
export interface Plan { days: PlanDay[]; perDay: number; error?: string }

const REVIEW_GAPS = [1, 3, 7];
const MAX_CHAPTERS = 60;

/** Chapters from a textarea: one per line (numbering and bullets stripped), or a number meaning that many. */
export function parseChapters(text: string): string[] {
  const t = text.trim();
  if (/^\d{1,2}$/.test(t)) return Array.from({ length: Math.min(Number(t), MAX_CHAPTERS) }, (_, i) => `Chapter ${i + 1}`);
  return t.split(/\r?\n/).map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean).slice(0, MAX_CHAPTERS);
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function makePlan({ chapters, today, exam }: { chapters: string[]; today: Date; exam: Date }): Plan {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(exam.getFullYear(), exam.getMonth(), exam.getDate());
  const total = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (!chapters.length) return { days: [], perDay: 0, error: "Add at least one chapter." };
  if (total < 1) return { days: [], perDay: 0, error: "Pick an exam date after today." };

  // the final stretch: a week when there's room, otherwise about a fifth of the time, at least one day
  const mockDays = total >= 21 ? 7 : Math.max(1, Math.floor(total / 5));
  const studyDays = Math.max(1, total - mockDays);
  const perDay = Math.ceil(chapters.length / studyDays);
  const days: PlanDay[] = Array.from({ length: total }, (_, i) => {
    const d = new Date(start); d.setDate(start.getDate() + i);
    return { date: iso(d), study: [], review: [], mock: i >= studyDays };
  });
  // spread the chapters evenly over the study days (not all bunched at the start)
  chapters.forEach((ch, k) => {
    const i = Math.min(studyDays - 1, Math.floor((k * studyDays) / chapters.length));
    days[i].study.push(ch);
    for (const gap of REVIEW_GAPS) if (i + gap < total) days[i + gap].review.push(ch);
  });
  return { days, perDay };
}
