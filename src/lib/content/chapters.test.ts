/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { chapterPublicPages, flashcardJsonLd, isReviewed, setIsLive, type ChapterSet } from "./chapters";
import { CHAPTER_SETS } from "./sets";

describe("chapter content", () => {
  it.each(CHAPTER_SETS.flatMap((s) => s.chapters.map((c) => [`${s.board} ${s.grade} ${s.subject}: ${c.title}`, c] as const)))("%s is complete and well-formed", (_n, c) => {
    expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(c.description.length).toBeGreaterThanOrEqual(100);
    expect(c.description.length).toBeLessThanOrEqual(170);
    expect(c.summary.length).toBeGreaterThanOrEqual(3);
    expect(c.cards.length).toBeGreaterThanOrEqual(15);
    expect(new Set(c.cards.map((x) => x.front)).size).toBe(c.cards.length);       // no repeated card
    for (const card of c.cards) { expect(card.front.trim()).not.toBe(""); expect(card.back.trim()).not.toBe(""); }
    expect(c.quiz.length).toBe(10);
    for (const q of c.quiz) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(4);
      expect(q.explanation.length).toBeGreaterThan(10);
    }
    expect(new Set(c.quiz.map((q) => q.answer)).size).toBeGreaterThanOrEqual(3);     // answers not all in one place
    expect(c.mistakes.length).toBeGreaterThanOrEqual(3);
    expect(c.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("chapter numbers run in order with unique slugs in each set", () => {
    for (const s of CHAPTER_SETS) {
      expect(s.chapters.map((c) => c.number)).toEqual(s.chapters.map((_, i) => i + 1));
      expect(new Set(s.chapters.map((c) => c.slug)).size).toBe(s.chapters.length);
    }
  });
});

describe("the review rule", () => {
  const set = (reviewed: boolean[]): ChapterSet => ({
    board: "CBSE", boardSlug: "cbse", grade: 10, subject: "Science", subjectSlug: "science", syllabus: { name: "x", url: "https://x.example" }, updated: "2026-11-14",
    chapters: reviewed.map((r, i) => ({ ...CHAPTER_SETS[0].chapters[0], slug: `c${i}`, number: i + 1, reviewed: r ? { by: "Archit", on: "2026-11-20" } : undefined })),
  });

  it("only reviewed chapters, and hubs with one, are public pages", () => {
    expect(chapterPublicPages([set([false, false])])).toEqual([]);
    expect(chapterPublicPages([set([true, false])]).map((p) => p.path)).toEqual(["/cbse/class-10/science", "/cbse/class-10/science/c0"]);
    expect(setIsLive(set([false]))).toBe(false);
    expect(isReviewed({ reviewed: { by: "", on: "2026-11-20" } })).toBe(false);       // a name is needed
    expect(isReviewed({ reviewed: { by: "Archit", on: "soon" } })).toBe(false);        // and a real date
  });

  it("the drafts shipped here are not reviewed yet, so none is public", () => {
    expect(CHAPTER_SETS.flatMap((s) => s.chapters).filter(isReviewed)).toEqual([]);
    expect(chapterPublicPages(CHAPTER_SETS)).toEqual([]);
  });

  it("flashcard markup: a Quiz whose every question is a Flashcard, matching the cards on the page", () => {
    const s = CHAPTER_SETS[0], c = s.chapters[0];
    const ld = flashcardJsonLd(s, c);
    expect(ld["@type"]).toBe("Quiz");
    expect(ld.hasPart).toHaveLength(c.cards.length);
    expect(ld.hasPart.every((q) => q.eduQuestionType === "Flashcard")).toBe(true);
    expect(ld.hasPart[0]).toMatchObject({ text: c.cards[0].front, acceptedAnswer: { text: c.cards[0].back } });
  });
});
