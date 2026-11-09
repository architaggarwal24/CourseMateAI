/** @vitest-environment node */
// The study tools on the Worker (Stage 4.4): quizzes, flashcards, notes, history, the review queue, exams and the
// concept map, against local D1 with scripted models.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as quiz from "@/app/api/v1/quiz/route";
import * as quizAnswer from "@/app/api/v1/quiz/answer/route";
import * as quizFinish from "@/app/api/v1/quiz/finish/route";
import * as quizRetry from "@/app/api/v1/quiz/retry/route";
import * as flashcards from "@/app/api/v1/flashcards/route";
import * as notes from "@/app/api/v1/notes/route";
import * as cardReview from "@/app/api/v1/study/flashcards/review/route";
import * as reviewDeck from "@/app/api/v1/study/review-deck/route";
import * as history from "@/app/api/v1/history/route";
import * as sessionHistory from "@/app/api/v1/history/session/[id]/route";
import * as chat from "@/app/api/v1/chat/route";
import * as reviewStats from "@/app/api/v1/review/stats/route";
import * as reviewQueue from "@/app/api/v1/review/queue/route";
import * as reviewGrade from "@/app/api/v1/review/grade/route";
import * as reviewCards from "@/app/api/v1/review/cards/route";
import * as reviewCard from "@/app/api/v1/review/cards/[id]/route";
import * as examsRoute from "@/app/api/v1/exams/route";
import * as examOptions from "@/app/api/v1/exams/options/route";
import * as examActive from "@/app/api/v1/exams/active/route";
import * as examOne from "@/app/api/v1/exams/[id]/route";
import * as examAnswers from "@/app/api/v1/exams/[id]/answers/route";
import * as examSubmit from "@/app/api/v1/exams/[id]/submit/route";
import * as conceptMap from "@/app/api/v1/concept-map/route";
import * as progress from "@/app/api/v1/courses/[id]/progress/route";
import * as coursesRoute from "@/app/api/v1/courses/route";
import { setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests, type ChatMessage } from "../ai/run";
import { fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { params, person, uploadPdf } from "../test/flows";
import { extractJson, normalizeCorrectAnswer, sameAnswer, stripOptionPrefixes } from "./text";
import { conceptMapDraft, quizBatch } from "./schemas";
import { plan as examPlan } from "./exams";
import { digest as mapDigest } from "./conceptMap";
import { shuffleOptions } from "./tools";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let llm: ReturnType<typeof fakeLlms>;

const BIO = [
  { page: 1, text: "Cell biology basics. The cell membrane controls what enters and leaves the cell. Membrane proteins move ions across the membrane." },
  { page: 2, text: "Mitochondria make ATP through cellular respiration. Respiration uses glucose and oxygen and releases carbon dioxide and water as products." },
  { page: 3, text: "Photosynthesis happens in chloroplasts. Chlorophyll captures light energy to make glucose from carbon dioxide and water in plant cells." },
];

let qn = 0;
function quizJson(m: ChatMessage[]) {
  const n = Number(m.at(-1)!.content.match(/EXACTLY (\d+)/)?.[1] ?? 1);
  return JSON.stringify({ questions: Array.from({ length: n }, () => {
    qn++;
    return { question: `Question ${qn} about mitochondria?`, options: ["A. ATP", "B. DNA", "C. RNA", "D. Fat"], correct_answer: "A", explanation: "They make ATP.", difficulty: "easy" };
  }) });
}
function examJson(m: ChatMessage[]) {
  const n = Number(m.at(-1)!.content.match(/Questions to write: (\d+)/)?.[1] ?? 1);
  return "```json\n" + JSON.stringify({ questions: Array.from({ length: n }, () => {
    qn++;
    return { question: `Exam question ${qn}?`, options: ["ATP", "DNA", "RNA", "Fat"], correct_answer: "ATP", explanation: "Energy.", concept: qn % 2 ? "Respiration" : "Membranes", difficulty: "medium", hint: "" };
  }) }) + "\n```";
}
const MAP = JSON.stringify({
  concepts: [
    { name: "Mitochondria", summary: "Make ATP.", importance: 3, page: 2 },
    { name: "Cell membrane", summary: "Controls entry.", importance: 2, page: 1 },
    { name: "Photosynthesis", summary: "Light to glucose.", importance: 3, page: "p.3" },
  ],
  relations: [{ source: "Mitochondria", target: "Photosynthesis", label: "complements" }, { source: "Mitochondria", target: "Nowhere", label: "x" }],
});

function script(m: ChatMessage[]): string {
  const all = m.map((x) => x.content).join("\n");
  if (all.includes("quiz generator")) return quizJson(m);
  if (all.includes("flashcards from the provided content")) {
    return JSON.stringify({ cards: [{ front: "What makes ATP?", back: "Mitochondria", topic: "cells" }, { front: "", back: "no front" }, { front: "Where is chlorophyll?", back: "Chloroplasts" }] });
  }
  if (all.includes("timed mock exam")) return examJson(m);
  if (all.includes("concept maps")) return MAP;
  if (all.includes("study notes")) return "# Mitochondria\n\n## Main Points\n- Make ATP";
  return "Mitochondria make ATP [1].";
}

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  setSearchForTests({ embedder: fakeEmbedder(), vectors: fakeVectors() });
  for (const [k, v] of Object.entries({ ...SETTINGS, ...AI_ENV, TOPIC_MIN_SIMILARITY: "0.2", RELEVANCE_BLOCK_BELOW: "0.1", RELEVANCE_CLARIFY_BELOW: "0.2" })) vi.stubEnv(k, v as string);
  llm = fakeLlms({ "*": script });
  setLlmFactoryForTests(llm.factory);
}, 60_000);
afterEach(async () => {
  setEnvForTests(null); setMailerForTests(null); setSearchForTests(null); setLlmFactoryForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

const post = (b: Awaited<ReturnType<typeof person>>, path: string, body: unknown) => b.request(path, { body });
const prompts = () => llm.calls.map((c) => c.messages.map((m) => m.content).join("\n"));

describe("text helpers", () => {
  it("extract JSON from fences, prose, trailing commas and a cut-off answer", () => {
    expect(extractJson('Sure! ```json\n{"a": [1, 2,],}\n``` done')).toEqual({ a: [1, 2] });
    expect(extractJson('Here: {"questions": [{"q": 1}, {"q": 2}, {"q": 3')).toEqual({ questions: [{ q: 1 }, { q: 2 }] });
    expect(extractJson("no json here")).toBeNull();
  });

  it("map an answer to its option, and refuse to guess", () => {
    const opts = ["A. ATP", "B. DNA", "C. RNA", "D. Fat"];
    expect(normalizeCorrectAnswer("B", opts)).toBe("B. DNA");
    expect(normalizeCorrectAnswer("c) RNA", opts)).toBe("C. RNA");
    expect(normalizeCorrectAnswer("fat", opts)).toBe("D. Fat");
    expect(normalizeCorrectAnswer("protein", opts)).toBeNull();
    expect(normalizeCorrectAnswer("yes", ["True", "False"], "True/False")).toBe("True");
    expect(stripOptionPrefixes(["A deterministic algorithm", "B-cell"])).toEqual(["A deterministic algorithm", "B-cell"]);
    expect(sameAnswer(" ATP! ", "atp")).toBe(true);
  });

  it("drop bad quiz items, keep the good ones", () => {
    const qs = quizBatch({ questions: [
      { question: "Q1?", options: ["A. x", "B. y", "C. z", "D. w"], correct_answer: "B" },
      { question: "Q2?", options: ["x", "y", "z"], correct_answer: "x" },                     // 3 options: dropped
      { question: "Q3?", options: ["A. x", "B. x", "C. z", "D. w"], correct_answer: "A" },   // duplicates: dropped
    ] }, "MCQ");
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ options: ["x", "y", "z", "w"], correct_answer: "y", explanation: "See course material.", difficulty: "medium" });
    expect(() => quizBatch({ questions: [] }, "MCQ")).toThrow();
    const map = conceptMapDraft(JSON.parse(MAP));
    expect(map.concepts.map((c) => c.page)).toEqual([2, 1, 3]);
    expect(map.relations).toEqual([{ source: "Mitochondria", target: "Photosynthesis", label: "complements" }]);
  });

  it("spread exam batches over topics and the concept-map digest over the document", () => {
    expect(examPlan(10, ["A", "B"])).toEqual([["A", "A", 5], ["B", "B", 5]]);
    expect(examPlan(20, []).map((x) => x[2])).toEqual([10, 10]);
    const d = mapDigest(Array.from({ length: 100 }, (_, i) => ({ page: i + 1, text: `passage ${i}` })), 1000);
    expect(d.startsWith("[p.1] passage 0")).toBe(true);
    expect(d).toContain("[p.");
  });
});

describe("quizzes", () => {
  it("answers stay on the server; each answer is graded once and counts for mastery; finishing scores it once", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const q = await json(await quiz.POST(post(b, "/api/v1/quiz", { topic: "mitochondria ATP respiration", num_questions: 3, question_type: "MCQ", session_id: id })));
    expect(q.content.questions).toHaveLength(3);
    expect(q.content.questions[0]).not.toHaveProperty("correct_answer");
    expect(q.content.questions[0]).not.toHaveProperty("explanation");
    expect(q.sources[0]).toMatch(/Bio\.pdf · p\./);

    const early = await quizFinish.POST(post(b, "/api/v1/quiz/finish", { quiz_id: q.quiz_id }));
    expect((await json(early)).error).toMatchObject({ code: "quiz_incomplete", details: { answered: 0, total: 3 } });

    const wrong = await json(await quizAnswer.POST(post(b, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: 1, answer: "DNA" })));
    expect(wrong).toMatchObject({ correct: false, correct_answer: "ATP", explanation: "They make ATP." });
    const again = await json(await quizAnswer.POST(post(b, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: 1, answer: "ATP" })));
    expect(again).toMatchObject({ answer: "DNA", correct: false });                    // the first answer is final
    expect((await quizAnswer.POST(post(b, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: 2, answer: "Water" }))).status).toBe(400);
    for (const qid of [2, 3]) await quizAnswer.POST(post(b, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: qid, answer: "atp" }));

    const done = await json(await quizFinish.POST(post(b, "/api/v1/quiz/finish", { quiz_id: q.quiz_id })));
    expect(done).toMatchObject({ score: 2, total: 3, already_finished: false, rewards: { ok: true, action_type: "quiz_complete" } });
    expect((await json(await quizFinish.POST(post(b, "/api/v1/quiz/finish", { quiz_id: q.quiz_id })))).already_finished).toBe(true);

    const deck = await json(await reviewDeck.GET(b.request(`/api/v1/study/review-deck?session_id=${id}`)));
    expect(deck.cards).toHaveLength(1);                                                 // the missed question
    expect(deck.cards[0]).toMatchObject({ back: "ATP", source: "quiz" });
    expect(await p.env.DB.prepare("SELECT COUNT(*) AS n FROM review_items WHERE source = 'quiz'").first("n")).toBe(1);

    const other = await person(mail, "other@example.com", "other");
    expect((await quizAnswer.POST(post(other, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: 1, answer: "ATP" }))).status).toBe(404);
  });

  it("hardened (round 7): written from numbered passages at the asked difficulty, checked by a second pass, options shuffled, the page shown with the answer", async () => {
    let n = 0;
    llm = fakeLlms({ "*": (m) => {
      const all = m.map((x) => x.content).join("\n");
      if (all.includes("quiz checker")) {
        // the checker disagrees with question 2's key, and finds question 3 unsupported
        const qs = JSON.parse(all.match(/QUESTIONS:\n(\[[\s\S]*?\])\n/)![1]) as { id: number }[];
        return JSON.stringify({ results: qs.map((q) => ({ id: q.id, answer: q.id === 2 ? "DNA" : "ATP", supported: q.id !== 3 })) });
      }
      if (all.includes("quiz generator")) {
        return JSON.stringify({ questions: Array.from({ length: 5 }, () => ({ question: `Hard question ${++n} about respiration?`, options: ["A. ATP", "B. DNA", "C. RNA", "D. Fat"],
          correct_answer: "A", explanation: "Respiration makes ATP.", difficulty: "hard", concept: "Cellular respiration", source: 1 })) });
      }
      return script(m);
    } });
    setLlmFactoryForTests(llm.factory);
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const q = await json(await quiz.POST(post(b, "/api/v1/quiz", { topic: "mitochondria ATP respiration", num_questions: 5, question_type: "MCQ", difficulty: "hard", session_id: id })));
    expect(q.content.questions).toHaveLength(3);                                       // 2 of 5 failed the check
    expect(q.content.questions.map((x: any) => x.question)).toEqual(["Hard question 1 about respiration?", "Hard question 4 about respiration?", "Hard question 5 about respiration?"]);
    expect(q.content.questions[0]).not.toHaveProperty("source_label");                  // hidden until answered
    const gen = prompts().find((t) => t.includes("quiz generator"))!;
    expect(gen).toContain("Difficulty: hard");
    expect(gen).toMatch(/\[1\] \(Bio\.pdf · p\.\d\)/);
    expect(gen).toMatch(/Test understanding/);
    const a = await json(await quizAnswer.POST(post(b, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: 1, answer: "DNA" })));
    expect(a).toMatchObject({ correct: false, correct_answer: "ATP", concept: "Cellular respiration", source: expect.stringMatching(/^Bio\.pdf · p\.\d$/) });
  });

  it("finishing lists what was missed (it's in the review queue now) and the weak spots; the missed ones can be retried with no AI call", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const q = await json(await quiz.POST(post(b, "/api/v1/quiz", { topic: "mitochondria ATP respiration", num_questions: 3, question_type: "MCQ", session_id: id })));
    await quizAnswer.POST(post(b, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: 1, answer: "DNA" }));
    for (const qid of [2, 3]) await quizAnswer.POST(post(b, "/api/v1/quiz/answer", { quiz_id: q.quiz_id, question_id: qid, answer: "ATP" }));
    expect((await json(await quizRetry.POST(post(b, "/api/v1/quiz/retry", { quiz_id: q.quiz_id })))).error.code).toBe("quiz_incomplete");
    const done = await json(await quizFinish.POST(post(b, "/api/v1/quiz/finish", { quiz_id: q.quiz_id })));
    expect(done).toMatchObject({ score: 2, missed: [1], added_to_review: 1, weak_concepts: ["mitochondria ATP respiration"] });
    const calls = llm.calls.length;
    const again = await json(await quizRetry.POST(post(b, "/api/v1/quiz/retry", { quiz_id: q.quiz_id })));
    expect(llm.calls.length).toBe(calls);
    expect(again.content.questions).toHaveLength(1);
    expect(again.content.questions[0].question).toBe(q.content.questions[0].question);
    expect(again.topic).toBe("mitochondria ATP respiration (retry)");
  });

  it("shuffles multiple-choice options but leaves True/False alone", () => {
    const q = { question: "Q?", options: ["ATP", "DNA", "RNA", "Fat"], correct_answer: "ATP", explanation: "", difficulty: "easy" as const };
    const seq = [0.1, 0.9, 0.5];
    let i = 0;
    const shuffled = shuffleOptions(q, () => seq[i++ % seq.length]);
    expect([...shuffled.options].sort()).toEqual([...q.options].sort());
    expect(shuffled.options).not.toEqual(q.options);
    expect(shuffled.correct_answer).toBe("ATP");
    const tf = { ...q, options: ["True", "False"], correct_answer: "True" };
    expect(shuffleOptions(tf).options).toEqual(["True", "False"]);
  });

  it("the spare questions of a batch serve the next quiz on the topic with no AI call", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const body = { topic: "mitochondria ATP respiration", num_questions: 2, question_type: "MCQ", session_id: id };
    const first = await json(await quiz.POST(post(b, "/api/v1/quiz", body)));            // asks for 5, serves 2
    const calls = llm.calls.length;
    const second = await json(await quiz.POST(post(b, "/api/v1/quiz", body)));
    expect(llm.calls.length).toBe(calls);
    const texts = (x: any) => x.content.questions.map((q: any) => q.question);
    expect(texts(second).some((t: string) => texts(first).includes(t))).toBe(false);   // never the same question twice
    await quiz.POST(post(b, "/api/v1/quiz", body));                                     // only 1 spare left: written anew
    expect(llm.calls.length).toBeGreaterThan(calls);
  });

  it("a topic the document doesn't cover is refused before any AI call", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const r = await quiz.POST(post(b, "/api/v1/quiz", { topic: "medieval french poetry", num_questions: 3, question_type: "MCQ", session_id: id }));
    expect((await json(r)).error.code).toBe("topic_not_found");
    expect(llm.calls).toHaveLength(0);
  });
});

describe("flashcards, notes and history", () => {
  it("flashcards drop a card without a front, are cached, and a graded card joins the review queue", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const body = { topic: "mitochondria ATP", session_id: id, num_cards: 5 };
    const deck = await json(await flashcards.POST(post(b, "/api/v1/flashcards", body)));
    expect(deck).toMatchObject({ total: 2, topic: "mitochondria ATP", rewards: { ok: true, action_type: "flashcard_complete" } });
    expect(deck.cards[0]).toMatchObject({ id: 1, front: "What makes ATP?", back: "Mitochondria", difficulty: "medium" });
    expect(prompts()[0]).toContain("Generate 8 flashcards");
    await flashcards.POST(post(b, "/api/v1/flashcards", body));
    expect(llm.calls).toHaveLength(1);                                                 // cached

    const r = await json(await cardReview.POST(post(b, "/api/v1/study/flashcards/review", { session_id: id, concept: "Mitochondria", correct: false, front: "What makes ATP?", back: "Mitochondria" })));
    expect(r).toMatchObject({ ok: true, concept: "Mitochondria", mastery: { seen: 1, correct: 0, wrong_streak: 1 } });
    expect(r.review_item).toMatchObject({ front: "What makes ATP?", reps: 1, source: "flashcard" });
  });

  it("notes come in the format picked (round 7), cite their passages, and each format is cached on its own", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    llm = fakeLlms({ "*": (m) => (m[0].content.includes("Cornell notes") ? "# Cells — Cornell notes\n\n| Cue | Notes |\n|---|---|\n| What makes ATP? | Mitochondria [1] |" : script(m)) });
    setLlmFactoryForTests(llm.factory);
    const body = { topic: "mitochondria ATP respiration", session_id: id, format: "cornell" };
    const r = await json(await notes.POST(post(b, "/api/v1/notes", body)));
    expect(r).toMatchObject({ format: "cornell", content: expect.stringContaining("Cornell notes") });
    expect(r.citations[0]).toMatchObject({ n: 1, doc_name: "Bio.pdf", label: expect.stringMatching(/^Bio\.pdf · p\.\d$/) });
    const sys = llm.calls[0].messages[0].content;
    expect(sys).toMatch(/Put the passage number in square brackets/);
    expect(llm.calls[0].messages[1].content).toMatch(/\[1\] \(Bio\.pdf · p\.\d\)/);
    await notes.POST(post(b, "/api/v1/notes", body));
    expect(llm.calls).toHaveLength(1);                                             // cached
    await notes.POST(post(b, "/api/v1/notes", { ...body, format: "cheatsheet" }));
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1].messages[0].content).toMatch(/Cheat sheet/);
    // an older client's detail level still works
    const old = await json(await notes.POST(post(b, "/api/v1/notes", { topic: "mitochondria ATP respiration", session_id: id, detail_level: "Ultra-detailed (Exam Ready)" })));
    expect(old.format).toBe("detailed");
  });

  it("notes are cached; chat, quiz and notes are in the history, oldest first per document", async () => {
    const b = await person(mail, "free@example.com", "free");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const body = { topic: "mitochondria ATP respiration", session_id: id, detail_level: "Normal (Simplified)" };
    const n1 = await json(await notes.POST(post(b, "/api/v1/notes", body)));
    expect(n1).toMatchObject({ mode: "notes", content: expect.stringContaining("# Mitochondria"), rewards: { ok: true, action_type: "notes_generation" } });
    await notes.POST(post(b, "/api/v1/notes", body));
    expect(llm.calls).toHaveLength(1);
    await chat.POST(post(b, "/api/v1/chat", { question: "How do mitochondria make ATP?", session_id: id }));
    const h = await json(await history.GET(b.request("/api/v1/history")));
    expect(h.history.map((x: any) => `${x.mode}:${x.action_type}`)).toEqual(expect.arrayContaining(["notes:generate", "chat:query", "chat:response"]));
    const s = await json(await sessionHistory.GET(b.request(`/api/v1/history/session/${id}`), params({ id })));
    expect(s.history.at(-1)).toMatchObject({ mode: "chat", action_type: "response", content: { answer: "Mitochondria make ATP [1]." } });
    const chatOnly = await json(await history.GET(b.request("/api/v1/history?mode=chat")));
    expect(chatOnly.history.every((x: any) => x.mode === "chat")).toBe(true);
    const other = await person(mail, "other@example.com", "other");
    expect((await json(await sessionHistory.GET(other.request(`/api/v1/history/session/${id}`), params({ id })))).history).toEqual([]);
  });
});

describe("the review queue", () => {
  it("is locked on Free (stats still answer); on a plan with it, cards are added, graded and removed", async () => {
    const free = await person(mail, "free@example.com", "free");
    expect(await json(await reviewStats.GET(free.request("/api/v1/review/stats")))).toMatchObject({ due: 0, locked: true });
    expect((await json(await reviewQueue.GET(free.request("/api/v1/review/queue")))).error.code).toBe("feature_locked");

    const b = await person(mail, "owner@example.com", "boss");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const add = await json(await reviewCards.POST(post(b, "/api/v1/review/cards", { session_id: id, cards: [
      { front: "What makes ATP?", back: "Mitochondria", concept: "Mitochondria" }, { front: "Where is chlorophyll?", back: "Chloroplasts" }, { front: "", back: "x" },
    ] })));
    expect(add).toMatchObject({ added: 2, existing: 0, skipped: 1, stats: { due: 2, new: 2, locked: false } });
    expect((await json(await reviewCards.POST(post(b, "/api/v1/review/cards", { session_id: id, cards: [{ front: "What makes ATP?", back: "M" }] })))).existing).toBe(1);

    const q = await json(await reviewQueue.GET(b.request(`/api/v1/review/queue?session_id=${id}`)));
    expect(q.items).toHaveLength(2);
    const card = q.items[0];
    expect(card).toMatchObject({ state: "new", reps: 0, document: { session_id: id, name: "Bio.pdf" } });
    expect(Object.keys(card.intervals)).toEqual(["1", "2", "3", "4"]);
    expect(card.intervals["4"]).toBeGreaterThan(card.intervals["1"]);

    const g = await json(await reviewGrade.POST(post(b, "/api/v1/review/grade", { item_id: card.id, rating: 3, reps: 0 })));
    expect(g.item).toMatchObject({ reps: 1 });
    expect(g.stats.reviewed_today).toBe(1);
    const stale = await reviewGrade.POST(post(b, "/api/v1/review/grade", { item_id: card.id, rating: 3, reps: 0 }));
    expect(stale.status).toBe(409);
    expect((await json(stale)).error.code).toBe("review_stale");

    expect((await reviewCard.DELETE(b.request(`/api/v1/review/cards/${card.id}`, { method: "DELETE" }), params({ id: String(card.id) }))).status).toBe(200);
    expect((await json(await reviewStats.GET(b.request("/api/v1/review/stats")))).total).toBe(1);
    // removed stays removed: adding the same flashcard again doesn't bring it back...
    expect((await json(await reviewCards.POST(post(b, "/api/v1/review/cards", { session_id: id, cards: [{ front: card.front, back: "M" }] })))).existing).toBe(1);
    expect((await json(await reviewQueue.GET(b.request(`/api/v1/review/queue?session_id=${id}`)))).items.map((i: { id: number }) => i.id)).not.toContain(card.id);
    // ...Undo does
    expect((await reviewCard.POST(post(b, `/api/v1/review/cards/${card.id}`, {}), params({ id: String(card.id) }))).status).toBe(200);
    expect((await json(await reviewStats.GET(b.request("/api/v1/review/stats")))).total).toBe(2);
  });

  it("a removed card comes back only when its question is missed again", async () => {
    const b = await person(mail, "owner@example.com", "boss");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const ctx = await import("@/server/context");
    const { upsertItem, removeItem, gradeFirst } = await import("./review");
    const c = await ctx.requestContext(b.request("/api/v1/review/stats"));
    const row = await c.env.DB.prepare("SELECT id FROM user WHERE email = ?").bind("owner@example.com").first<{ id: number }>();
    const hash = (await c.env.DB.prepare("SELECT file_hash FROM documents WHERE id = ?").bind(id).first<{ file_hash: string }>())!.file_hash;
    const card = { front: "What is DBSCAN?", back: "Density clustering", source: "quiz" };
    const itemId = (await upsertItem(c, row!.id, hash, card))!;
    await removeItem(c, row!.id, itemId);
    const live = async () => (await c.env.DB.prepare("SELECT removed_at FROM review_items WHERE id = ?").bind(itemId).first<{ removed_at: string | null }>())!.removed_at;
    expect(await live()).not.toBeNull();
    await gradeFirst(c, row!.id, hash, { front: card.front, back: card.back }, true);     // seen and got right: stays out
    expect(await live()).not.toBeNull();
    await upsertItem(c, row!.id, hash, card);                                             // missed again: back
    expect(await live()).toBeNull();
  });
});

describe("exams", () => {
  it("are a Sage feature: written in batches, answered without feedback, graded once with a breakdown", async () => {
    const free = await person(mail, "free@example.com", "free");
    expect((await json(await examActive.GET(free.request("/api/v1/exams/active")))).error).toMatchObject({ code: "feature_locked", details: { required_tier: "sage" } });

    const b = await person(mail, "owner@example.com", "boss");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    expect(await json(await examOptions.GET(b.request(`/api/v1/exams/options?session_id=${id}`)))).toMatchObject({ lengths: [10, 20, 30], max_topics: 5 });
    const e = await json(await examsRoute.POST(post(b, "/api/v1/exams", { session_id: id, length: 10, difficulty: "easy" })));
    expect(e).toMatchObject({ status: "active", total: 10, time_limit_s: 600, answered: 0 });
    expect(e.questions[0]).not.toHaveProperty("correct_answer");
    expect((await json(await examsRoute.POST(post(b, "/api/v1/exams", { session_id: id, length: 10 })))).error.code).toBe("exam_in_progress");
    expect((await json(await examActive.GET(b.request("/api/v1/exams/active")))).exam.id).toBe(e.id);

    const ans = (body: unknown) => examAnswers.POST(post(b, `/api/v1/exams/${e.id}/answers`, body), params({ id: e.id }));
    expect(await json(await ans({ index: 0, answer: "DNA", flagged: true }))).toMatchObject({ answer: "DNA", flagged: true, answered: 1 });
    expect(await json(await ans({ index: 0, answer: "atp" }))).toMatchObject({ answer: "ATP", flagged: true });
    await ans({ index: 1, answer: "DNA" });
    expect((await ans({ index: 2, answer: "Water" })).status).toBe(400);

    const graded = await json(await examSubmit.POST(post(b, `/api/v1/exams/${e.id}/submit`, {}), params({ id: e.id })));
    expect(graded).toMatchObject({ status: "graded", rewards: { ok: true, action_type: "exam_complete" }, result: { score: 1, total: 10, unanswered: 8 } });
    expect(graded.questions[0]).toMatchObject({ correct_answer: "ATP", correct: true });
    expect(graded.result.concepts[0].accuracy).toBeLessThanOrEqual(graded.result.concepts.at(-1).accuracy);
    expect((await ans({ index: 3, answer: "ATP" })).status).toBe(409);
    expect((await json(await examOne.GET(b.request(`/api/v1/exams/${e.id}`), params({ id: e.id })))).result.score).toBe(1);
    expect((await json(await examsRoute.GET(b.request("/api/v1/exams")))).exams[0]).toMatchObject({ id: e.id, score: 1 });
    expect(await p.env.DB.prepare("SELECT COUNT(*) AS n FROM review_items WHERE source = 'exam'").first("n")).toBe(9);
    const opts = await json(await examOptions.GET(b.request(`/api/v1/exams/options?session_id=${id}`)));
    expect(opts.suggested_topics).toEqual(expect.arrayContaining(["Respiration", "Membranes"]));
  });

  it("an exam past its time is graded on read, with what was saved", async () => {
    const b = await person(mail, "owner@example.com", "boss");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const e = await json(await examsRoute.POST(post(b, "/api/v1/exams", { session_id: id, length: 10, difficulty: "easy" })));
    await p.env.DB.prepare("UPDATE exams SET deadline = '2000-01-01T00:00:00Z', started_at = '1999-12-31T23:50:00Z' WHERE id = ?").bind(e.id).run();
    const r = await json(await examOne.GET(b.request(`/api/v1/exams/${e.id}`), params({ id: e.id })));
    expect(r).toMatchObject({ status: "graded", result: { auto_submitted: true, score: 0 } });
  });
});

describe("the concept map", () => {
  it("is made once per document, shown with mastery heat, and reused at no cost", async () => {
    const b = await person(mail, "owner@example.com", "boss");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    expect(await json(await conceptMap.GET(b.request(`/api/v1/concept-map?session_id=${id}`)))).toMatchObject({ status: "none", built: 0, total: 1 });
    const m = await json(await conceptMap.POST(post(b, "/api/v1/concept-map", { session_id: id })));
    expect(m).toMatchObject({ status: "ready", built: 1, scope: { kind: "document", name: "Bio.pdf" } });
    expect(m.concepts.map((c: any) => c.name)).toEqual(["Mitochondria", "Photosynthesis", "Cell membrane"]);
    expect(m.concepts[0]).toMatchObject({ heat: "new", pages: [{ doc_id: id, page: 2 }] });
    expect(m.relations).toEqual([{ source: "mitochondria", target: "photosynthesis", label: "complements" }]);
    expect(prompts()[0]).toContain("[p.1]");

    await cardReview.POST(post(b, "/api/v1/study/flashcards/review", { session_id: id, concept: "Mitochondria", correct: false }));
    await cardReview.POST(post(b, "/api/v1/study/flashcards/review", { session_id: id, concept: "Mitochondria", correct: false }));
    const again = await json(await conceptMap.POST(post(b, "/api/v1/concept-map", { session_id: id })));
    expect(again.concepts[0].heat).toBe("weak");
    expect(llm.calls).toHaveLength(1);
  });

  it("an unusable answer fails the build (after a retry with a shorter digest), and it can be tried again", async () => {
    llm = fakeLlms({ "*": () => "I can't do that." });
    setLlmFactoryForTests(llm.factory);
    const b = await person(mail, "owner@example.com", "boss");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const m = await json(await conceptMap.POST(post(b, "/api/v1/concept-map", { session_id: id })));
    expect(m).toMatchObject({ status: "failed", documents: [{ status: "failed", error: expect.stringMatching(/couldn't be made/) }] });
    expect(llm.calls.length).toBeGreaterThanOrEqual(2);
    llm = fakeLlms({ "*": script });
    setLlmFactoryForTests(llm.factory);
    expect((await json(await conceptMap.POST(post(b, "/api/v1/concept-map", { session_id: id })))).status).toBe("ready");
  });

  it("is locked below Sage", async () => {
    const b = await person(mail, "free@example.com", "free");
    expect((await json(await conceptMap.GET(b.request("/api/v1/concept-map?session_id=x")))).error.code).toBe("feature_locked");
  });
});

describe("course progress", () => {
  it("counts the mastery and review cards of its documents", async () => {
    const b = await person(mail, "owner@example.com", "boss");
    const id = await uploadPdf(b, "Bio.pdf", BIO);
    const c = await json(await coursesRoute.POST(post(b, "/api/v1/courses", { name: "Biology", document_ids: [id] })));
    await cardReview.POST(post(b, "/api/v1/study/flashcards/review", { session_id: id, concept: "Mitochondria", correct: true, front: "What makes ATP?", back: "Mitochondria" }));
    await cardReview.POST(post(b, "/api/v1/study/flashcards/review", { session_id: id, concept: "Membranes", correct: false }));
    const pr = await json(await progress.GET(b.request(`/api/v1/courses/${c.id}/progress`), params({ id: c.id })));
    expect(pr).toMatchObject({ concepts: { seen: 2, weak: 1, weakest: ["Membranes"] }, answers: { total: 2, correct: 1, accuracy: 0.5 }, review: { cards: 1 } });
    expect(pr.documents[0]).toMatchObject({ id, concepts: 2, answered: 2, accuracy: 0.5 });
  });
});
