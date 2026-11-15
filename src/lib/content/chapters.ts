// Chapter pages (SEO pass, stage 4): one public page per syllabus chapter, with an original summary, flashcards
// (Google's flashcard rich result: Education Q&A), a short quiz and common mistakes. Drafted with AI help, in our
// own words (never NCERT's text, questions or diagrams), then checked by a person.
//
// THE REVIEW RULE: a chapter is `noindex` and left out of the sitemap until `reviewed` is filled in by the person who
// checked every card, answer and fact against the textbook. Unreviewed pages can be opened (to review them) but
// search engines are told not to index them. Fill in `reviewed` only after checking.

export interface ChapterCard { front: string; back: string }
export interface ChapterQuestion { question: string; options: string[]; answer: number; explanation: string }
export interface Chapter {
  slug: string;
  number: number;
  title: string;
  /** When this page's words last really changed (the sitemap's lastmod). */
  updated: string;
  /** Who checked it and when (YYYY-MM-DD). Absent = not reviewed yet: noindex, not in the sitemap. */
  reviewed?: { by: string; on: string };
  /** One line for search results (about 150 characters). */
  description: string;
  summary: string[];
  keyPoints: string[];
  cards: ChapterCard[];
  quiz: ChapterQuestion[];
  mistakes: string[];
}
export interface ChapterSet {
  board: string;
  boardSlug: string;
  grade: number;
  subject: string;
  subjectSlug: string;
  /** The syllabus the chapters follow, and where it was published. */
  syllabus: { name: string; url: string };
  updated: string;
  chapters: Chapter[];
}

export const setPath = (s: Pick<ChapterSet, "boardSlug" | "grade" | "subjectSlug">) => `/${s.boardSlug}/class-${s.grade}/${s.subjectSlug}`;
export const chapterPath = (s: ChapterSet, c: Pick<Chapter, "slug">) => `${setPath(s)}/${c.slug}`;
export const isReviewed = (c: Pick<Chapter, "reviewed">) => !!c.reviewed?.by && /^\d{4}-\d{2}-\d{2}$/.test(c.reviewed.on);
/** A set's hub is indexed once at least one of its chapters is. */
export const setIsLive = (s: ChapterSet) => s.chapters.some(isReviewed);

export const setTitle = (s: ChapterSet) => `${s.board} Class ${s.grade} ${s.subject}: chapter summaries, flashcards and quizzes`;
export const setDescription = (s: ChapterSet) =>
  `Every ${s.board} Class ${s.grade} ${s.subject} chapter in plain words: a summary, flashcards to revise with and a short practice quiz. Free.`;
export const chapterTitle = (s: ChapterSet, c: Chapter) => `${c.title}: Class ${s.grade} ${s.subject} summary, flashcards and quiz`;

/**
 * Education Q&A markup (https://developers.google.com/search/docs/appearance/structured-data/education-qa): the
 * chapter's flashcards as a Quiz of Flashcard questions. Only the flashcards: every question in it must be a
 * flashcard, and each must be visible on the page (they are, in the Flashcards list).
 */
export function flashcardJsonLd(s: ChapterSet, c: Chapter) {
  return {
    "@context": "https://schema.org",
    "@type": "Quiz",
    name: `${c.title}: flashcards`,
    about: { "@type": "Thing", name: c.title },
    educationalAlignment: [
      { "@type": "AlignmentObject", alignmentType: "educationalSubject", targetName: s.subject },
      { "@type": "AlignmentObject", alignmentType: "educationalLevel", targetName: `${s.board} Class ${s.grade}` },
    ],
    hasPart: c.cards.map((card) => ({
      "@type": "Question", eduQuestionType: "Flashcard", text: card.front,
      acceptedAnswer: { "@type": "Answer", text: card.back },
    })),
  };
}

/** The pages search engines may index (src/lib/site.ts PUBLIC_PAGES): live hubs and reviewed chapters only. */
export function chapterPublicPages(sets: readonly ChapterSet[]) {
  return sets.flatMap((s) => setIsLive(s) ? [
    { path: setPath(s), title: setTitle(s), description: setDescription(s), lastModified: s.updated },
    ...s.chapters.filter(isReviewed).map((c) => ({ path: chapterPath(s, c), title: chapterTitle(s, c), description: c.description, lastModified: c.updated })),
  ] : []);
}
