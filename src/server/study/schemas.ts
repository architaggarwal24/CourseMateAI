// What the model must answer as data, and the checks on what came back (port of backend/core_brains/llm_schemas.py).
// A bad item is dropped, never patched up with made-up values; an answer with no usable item at all is rejected.
import { normalizeCorrectAnswer, questionKey, stripOptionPrefixes } from "./text";

export class BadAnswer extends Error {}

const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const difficulty = (v: unknown): Difficulty => (DIFFICULTIES as readonly string[]).includes(v as string) ? (v as Difficulty) : "medium";
const list = (data: unknown, key: string): unknown[] => {
  const v = data && typeof data === "object" ? (data as Record<string, unknown>)[key] : undefined;
  return Array.isArray(v) ? v : Array.isArray(data) ? data : [];
};
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

// ── quiz ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface QuizQuestion { question: string; options: string[]; correct_answer: string; explanation: string; difficulty: Difficulty; concept?: string }

export function quizQuestion(raw: unknown, questionType: string): QuizQuestion | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.options)) return null;
  const question = text(o.question);
  let options = o.options.map((x) => String(x));
  let correct = text(o.correct_answer);
  if (!question || options.length < 2 || !correct) return null;
  const explanation = text(o.explanation) || "See course material.";
  const concept = text(o.concept).slice(0, 200) || undefined;
  const isTf = options.length === 2 && options.every((x) => ["true", "false"].includes(x.trim().toLowerCase()));
  if (questionType === "True/False" || isTf) {
    const a = normalizeCorrectAnswer(correct, ["True", "False"], "True/False");
    if (!a) return null;
    return { question, options: ["True", "False"], correct_answer: a, explanation, difficulty: difficulty(o.difficulty), ...(concept ? { concept } : {}) };
  }
  if (options.length < 4) return null;
  const original = options.slice(0, 4);
  const mapped = normalizeCorrectAnswer(correct, original, "MCQ");
  if (mapped === null) return null;
  const clean = stripOptionPrefixes(original);
  if (clean.some((x) => !x) || new Set(clean.map((x) => x.toLowerCase())).size < 4) return null;
  correct = clean[original.indexOf(mapped)];
  options = clean;
  return { question, options, correct_answer: correct, explanation, difficulty: difficulty(o.difficulty), ...(concept ? { concept } : {}) };
}

export function quizBatch(data: unknown, questionType: string): QuizQuestion[] {
  const out = list(data, "questions").map((q) => quizQuestion(q, questionType)).filter((q): q is QuizQuestion => !!q);
  if (!out.length) throw new BadAnswer("no valid questions");
  return out;
}

/** Questions from parallel batches: duplicates dropped, at most `n`, ids from 1. */
export function mergeQuestions<T extends { question: string }>(questions: T[], n: number): (T & { id: number })[] {
  const seen = new Set<string>();
  const out: (T & { id: number })[] = [];
  for (const q of questions) {
    const k = questionKey(q.question);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...q, id: out.length + 1 });
    if (out.length >= n) break;
  }
  return out;
}

// ── flashcards ───────────────────────────────────────────────────────────────────────────────────────────────
export interface Flashcard { front: string; back: string; topic: string; difficulty: Difficulty }

export function flashcardSet(data: unknown): Flashcard[] {
  const out = list(data, "cards").flatMap((raw) => {
    const o = obj(raw);
    if (!o) return [];
    const front = text(o.front), back = text(o.back);
    if (!front || !back) return [];
    return [{ front, back, topic: text(o.topic) || "general", difficulty: difficulty(o.difficulty) }];
  });
  if (!out.length) throw new BadAnswer("no valid cards");
  return out;
}

// ── exam questions (the arena's battle-question shape) ──────────────────────────────────────────────────────
export interface ExamQuestion { question: string; options: string[]; correct_answer: string; explanation: string; concept: string; difficulty: Difficulty }

export function examQuestions(data: unknown): ExamQuestion[] {
  const out = list(data, "questions").flatMap((raw) => {
    const o = obj(raw);
    if (!o || !Array.isArray(o.options)) return [];
    const options = o.options.map((x) => String(x));
    const question = text(o.question);
    if (!question || options.length < 2) return [];
    const mapped = normalizeCorrectAnswer(text(o.correct_answer), options);
    if (mapped === null) return [];
    let concept = text(o.concept).slice(0, 200);
    if (!concept || /^concept_\d+$/.test(concept)) concept = "General";
    const lvl = text(o.difficulty).toLowerCase();
    return [{ question, options, correct_answer: mapped, explanation: text(o.explanation), concept, difficulty: difficulty(lvl) }];
  });
  if (!out.length) throw new BadAnswer("no valid questions");
  return out;
}

// ── concept map ──────────────────────────────────────────────────────────────────────────────────────────────
export const MAX_MAP_CONCEPTS = 24;
export const MAX_MAP_RELATIONS = 40;
export interface MapConceptDraft { name: string; summary: string; importance: number; page: number | null }
export interface MapRelationDraft { source: string; target: string; label: string }

export function conceptMapDraft(data: unknown): { concepts: MapConceptDraft[]; relations: MapRelationDraft[] } {
  const seen = new Map<string, string>();
  const concepts: MapConceptDraft[] = [];
  for (const raw of list(data, "concepts")) {
    const o = obj(raw);
    if (!o) continue;
    const name = text(o.name);
    if (!name || name.length > 80) continue;
    const imp = Number.parseInt(String(o.importance), 10);
    const page = Number.parseInt(String(o.page ?? "").replace(/^[pP. ]+/, ""), 10);
    const key = questionKey(name);
    if (!key || seen.has(key) || concepts.length >= MAX_MAP_CONCEPTS) continue;
    seen.set(key, name);
    concepts.push({ name, summary: text(o.summary).slice(0, 240), importance: Number.isFinite(imp) ? Math.max(1, Math.min(3, imp)) : 2,
                    page: Number.isFinite(page) && page >= 1 ? page : null });
  }
  if (concepts.length < 2) throw new BadAnswer("a concept map needs at least two concepts");
  const relations: MapRelationDraft[] = [];
  const pairs = new Set<string>();
  for (const raw of list(data, "relations")) {
    const o = obj(raw);
    if (!o) continue;
    const a = seen.get(questionKey(text(o.source))), b = seen.get(questionKey(text(o.target)));
    if (!a || !b || a === b || pairs.has(`${a}\u0000${b}`) || pairs.has(`${b}\u0000${a}`) || relations.length >= MAX_MAP_RELATIONS) continue;
    pairs.add(`${a}\u0000${b}`);
    relations.push({ source: a, target: b, label: text(o.label).slice(0, 40) });
  }
  return { concepts, relations };
}
