// Every chapter set with public pages (src/lib/content/chapters.ts). Add a set here to give it pages.
import type { ChapterSet } from "./chapters";
import { CBSE_10_SCIENCE } from "./cbse-10-science";

export const CHAPTER_SETS: readonly ChapterSet[] = [CBSE_10_SCIENCE];

export const findSet = (board: string, klass: string, subject: string) =>
  CHAPTER_SETS.find((s) => s.boardSlug === board && `class-${s.grade}` === klass && s.subjectSlug === subject);
