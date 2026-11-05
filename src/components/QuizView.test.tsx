import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bodyOf, json, urlOf } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() }));
vi.mock("@/hooks/useHUD", () => ({ useHUDStore: (sel: (s: unknown) => unknown) => sel({ refreshIfStale: vi.fn(), refresh: vi.fn(), userId: "1" }) }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));

import QuizView from "@/components/QuizView";

type Q = { id: number; question: string; options: string[]; correct: string; explanation?: string };
const BANK: Q[] = [
  { id: 1, question: "Which organelle makes ATP?", options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi"], correct: "Mitochondria", explanation: "Mitochondria run oxidative phosphorylation." },
  { id: 2, question: "Where is DNA stored?", options: ["Nucleus", "Vacuole", "Lysosome", "Membrane"], correct: "Nucleus" },
  { id: 3, question: "Water is a polar molecule.", options: ["True", "False"], correct: "True", explanation: "Its charge is unevenly shared." },
];

/** The server: the quiz holds `questions` (what it generated, maybe fewer than asked); answers are graded here. */
function server(questions: Q[], opts: { failAnswerOnce?: boolean } = {}) {
  const log = { generate: [] as any[], answers: [] as any[], finish: [] as any[] };
  let failed = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(urlOf(input)).pathname;
    const body = await bodyOf(input, init);
    if (path.endsWith("/quiz/answer")) {
      log.answers.push(body);
      if (opts.failAnswerOnce && !failed) { failed = true; return json(500, { error: { code: "internal", message: "Couldn't reach the grader.", action: "retry", details: null } }); }
      const q = questions.find((x) => x.id === body.question_id)!;
      return json(200, { ok: true, question_id: q.id, answer: body.answer, correct: body.answer === q.correct, correct_answer: q.correct, explanation: q.explanation ?? null });
    }
    if (path.endsWith("/quiz/finish")) {
      log.finish.push(body);
      return json(200, { ok: true, quiz_id: "qz1", score: 0, total: questions.length, accuracy: 0, already_finished: false,
        rewards: { ok: true, xp_gained: 30, coins_gained: 5, new_achievements: [] } });
    }
    if (path.endsWith("/quiz")) {
      log.generate.push(body);
      return json(200, { mode: "quiz", quiz_id: "qz1", sources: [],
        content: { questions: questions.map(({ id, question, options }) => ({ id, question, options })) } });
    }
    throw new Error(`unexpected ${path}`);
  }));
  return log;
}

const generate = async (topic = "cells", count?: number) => {
  render(<QuizView documentId="d1" />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: topic } });
  if (count) fireEvent.change(screen.getByRole("slider"), { target: { value: String(count) } });
  fireEvent.click(screen.getByRole("button", { name: "Generate quiz" }));
  await screen.findByText(/Question 1 of/);
};
const press = (key: string) => fireEvent.keyDown(window, { key });
const option = (text: RegExp | string) => screen.getByRole("button", { name: text });

beforeEach(() => { localStorage.clear(); Object.values(toasts).forEach((f) => f.mockClear()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QuizView: one question per screen", () => {
  it("shows 'n of N' progress and only the current question", async () => {
    server(BANK);
    await generate();
    expect(screen.getByText("Question 1 of 3")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Quiz progress" }).getAttribute("aria-valuetext")).toBe("Question 1 of 3");
    expect(screen.getByText("Which organelle makes ATP?")).toBeTruthy();
    expect(screen.queryByText("Where is DNA stored?")).toBeNull();
    expect(screen.getByText("Press 1–4 to answer")).toBeTruthy();
  });
});

describe("QuizView: answering", () => {
  it("answers with the number keys: the server grades it, then the verdict and explanation appear", async () => {
    const log = server(BANK);
    await generate();
    press("2");                                                              // Mitochondria
    await screen.findByText("Correct");
    expect(log.answers).toEqual([{ quiz_id: "qz1", question_id: 1, answer: "Mitochondria" }]);
    expect(screen.getByText("Mitochondria run oxidative phosphorylation.")).toBeTruthy();
    expect(option(/Mitochondria/).textContent).toContain("Your answer · Correct");   // text, not just colour

    press("1");                                                              // answers are final and keys are off now
    await new Promise((r) => setTimeout(r, 10));
    expect(log.answers).toHaveLength(1);

    const next = screen.getByRole("button", { name: /Next question/ });
    expect(document.activeElement).toBe(next);                               // Enter carries on
    fireEvent.click(next);
    expect(screen.getByText("Question 2 of 3")).toBeTruthy();
    expect(screen.queryByText("Correct")).toBeNull();
  });

  it("answers by click too, and marks a wrong pick with an icon and text, plus where the right answer was", async () => {
    const log = server(BANK);
    await generate();
    fireEvent.click(option(/Ribosome/));
    await screen.findByText(/Incorrect\. The correct answer is Mitochondria/);
    expect(log.answers[0].answer).toBe("Ribosome");
    expect(option(/Ribosome/).textContent).toContain("Your answer · Incorrect");
    expect(option(/Mitochondria/).textContent).toContain("Correct answer");
    expect(option(/Ribosome/).querySelector("svg")).toBeTruthy();            // an icon, not only a colour
    expect(option(/Mitochondria/).querySelector("svg")).toBeTruthy();
    expect(option(/Nucleus/).textContent).not.toMatch(/Correct|Incorrect|Your answer/);
    for (const b of screen.getAllByRole("listitem").map((li) => li.querySelector("button")!)) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignores keys that have no option (a True/False question has two) and keys typed into a field", async () => {
    const log = server([BANK[2], BANK[0]]);
    await generate();
    expect(screen.getByText("Press 1–2 to answer")).toBeTruthy();
    press("3"); press("4");
    const stray = document.body.appendChild(document.createElement("input"));
    fireEvent.keyDown(stray, { key: "1", bubbles: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(log.answers).toEqual([]);
    press("1");
    await screen.findByText("Correct");
    expect(log.answers[0].answer).toBe("True");
    stray.remove();
  });

  it("keeps the question open and says so when the answer could not be checked", async () => {
    const log = server(BANK, { failAnswerOnce: true });
    await generate();
    press("2");
    await waitFor(() => expect(toasts.apiError).toHaveBeenCalledWith(expect.objectContaining({ message: "Couldn't reach the grader." }), { onRetry: expect.any(Function) }));
    expect(screen.queryByText("Correct")).toBeNull();
    press("2");                                                              // can answer again
    await screen.findByText("Correct");
    expect(log.answers).toHaveLength(2);
  });
});

describe("QuizView: review screen", () => {
  it("lists every question with the user's answer and the correct one, after the last answer", async () => {
    const log = server(BANK);
    await generate();
    press("2"); await screen.findByText("Correct");
    fireEvent.click(screen.getByRole("button", { name: /Next question/ }));
    press("2"); await screen.findByText(/Incorrect\. The correct answer is Nucleus/);            // Vacuole: wrong
    fireEvent.click(screen.getByRole("button", { name: /Next question/ }));
    press("1"); await screen.findByText("Correct");                                           // True
    fireEvent.click(screen.getByRole("button", { name: "Finish quiz" }));

    expect(await screen.findByText("2 of 3 correct")).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "Review" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("Which organelle makes ATP?");
    expect(within(rows[0]).getByText("Correct")).toBeTruthy();
    expect(rows[0].textContent).toMatch(/Your answer:\s*Mitochondria/);
    expect(rows[0].textContent).toMatch(/Correct answer:\s*Mitochondria/);
    expect(within(rows[1]).getByText("Incorrect")).toBeTruthy();
    expect(rows[1].textContent).toMatch(/Your answer:\s*Vacuole/);
    expect(rows[1].textContent).toMatch(/Correct answer:\s*Nucleus/);
    expect(rows[2].textContent).toMatch(/Your answer:\s*True/);

    await waitFor(() => expect(log.finish).toEqual([{ quiz_id: "qz1" }]));                   // paid out once, by the server
    expect(toasts.success).toHaveBeenCalledWith("+30 XP | +5 Coins", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "New quiz" }));                        // back to setup
    expect(screen.getByRole("button", { name: "Generate quiz" })).toBeTruthy();
  });
});

describe("QuizView: a quiz shorter than requested", () => {
  const NO_ERROR_TEXT = /error|fewer|requested|couldn't|failed|only \d|expected/i;

  it("just works: 2 questions come back for 8 asked, with no error or apology anywhere", async () => {
    const log = server(BANK.slice(0, 2));
    await generate("cells", 8);
    expect(log.generate[0].num_questions).toBe(8);
    expect(screen.getByText("Question 1 of 2")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NO_ERROR_TEXT);

    press("2"); await screen.findByText("Correct");
    fireEvent.click(screen.getByRole("button", { name: /Next question/ }));
    expect(screen.getByText("Question 2 of 2")).toBeTruthy();
    press("1"); await screen.findByText("Correct");
    fireEvent.click(screen.getByRole("button", { name: "Finish quiz" }));

    expect(await screen.findByText("2 of 2 correct")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Review" })).getAllByRole("listitem")).toHaveLength(2);
    await waitFor(() => expect(log.finish).toHaveLength(1));
    expect(document.body.textContent).not.toMatch(NO_ERROR_TEXT);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("works with a single question: '1 of 1', 'Finish quiz' straight away", async () => {
    server(BANK.slice(0, 1));
    await generate("cells", 10);
    expect(screen.getByText("Question 1 of 1")).toBeTruthy();
    press("2"); await screen.findByText("Correct");
    expect(screen.queryByRole("button", { name: /Next question/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finish quiz" }));
    expect(await screen.findByText("1 of 1 correct")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(NO_ERROR_TEXT);
  });
});
