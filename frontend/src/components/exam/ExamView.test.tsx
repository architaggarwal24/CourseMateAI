import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bodyOf, json, urlOf } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));
vi.mock("@/hooks/useHUD", () => ({ useHUDStore: (sel: (s: unknown) => unknown) => sel({ refreshIfStale: vi.fn() }) }));

import ExamView from "./ExamView";

const QS = [0, 1, 2].map((i) => ({ index: i, question: `Exam question ${i + 1}?`, options: [`A${i}`, `B${i}`, `C${i}`, `D${i}`], answer: null, flagged: false }));
const exam = (over: Record<string, unknown> = {}) => ({
  id: "e1", status: "active", session_id: "d1", doc_name: "biology.pdf", length: 3, difficulty: "hard", topics: [],
  time_limit_s: 270, started_at: "2026-11-04T09:00:00+00:00", deadline: "2026-11-04T09:04:30+00:00", seconds_left: 270,
  answered: 0, total: 3, questions: QS.map((q) => ({ ...q })), ...over,
});
const graded = () => exam({
  status: "graded", seconds_left: 0, answered: 1,
  questions: QS.map((q, i) => ({ ...q, answer: i === 0 ? "B0" : null, correct_answer: `A${i}`, explanation: `Because ${i}.`,
                                  concept: i === 2 ? "Osmosis" : "ATP", difficulty: "hard", correct: false })),
  result: { score: 0, total: 3, accuracy: 0, time_used_s: 95, submitted_at: "2026-11-04T09:01:35+00:00", auto_submitted: false,
            concepts: [{ concept: "ATP", correct: 0, total: 2, accuracy: 0 }, { concept: "Osmosis", correct: 0, total: 1, accuracy: 0 }],
            difficulties: [{ difficulty: "hard", correct: 0, total: 3, accuracy: 0 }], unanswered: 2, weak_concepts: ["ATP", "Osmosis"] },
  rewards: { ok: true, xp_gained: 150, coins_gained: 40 },
});

function server(opts: { active?: unknown; locked?: boolean } = {}) {
  const log = { creates: [] as any[], answers: [] as any[], submits: 0 };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(urlOf(input));
    const path = url.pathname.replace("/api/v1", "");
    const method = (typeof input === "object" && "method" in input ? input.method : init?.method) ?? "GET";
    if (opts.locked) {
      return json(403, { error: { code: "feature_locked", message: "Exam mode comes with the Sage plan.", action: null,
                                  details: { feature: "exam_mode", tier: "scholar", required_tier: "sage", required_tier_name: "Sage" } } });
    }
    if (path === "/exams/active") return json(200, { exam: opts.active ?? null });
    if (path === "/exams/options") return json(200, { lengths: [10, 20, 30], difficulties: ["easy", "medium", "hard", "mixed"],
      seconds_per_question: { easy: 60, medium: 75, hard: 90, mixed: 75 }, suggested_topics: ["Osmosis", "ATP"], max_topics: 5 });
    if (path === "/exams" && method === "GET") return json(200, { exams: [] });
    if (path === "/exams" && method === "POST") { log.creates.push(await bodyOf(input, init)); return json(200, exam()); }
    if (path === "/exams/e1/answers") {
      const b = await bodyOf(input, init);
      log.answers.push(b);
      return json(200, { ok: true, index: b.index, answer: b.clear ? null : b.answer ?? null, flagged: !!b.flagged, answered: 1, seconds_left: 200 });
    }
    if (path === "/exams/e1/submit") { log.submits += 1; return json(200, graded()); }
    if (path.startsWith("/review/")) return json(200, {});
    return json(404, { error: { code: "not_found", message: "nope", action: null, details: null } });
  }));
  return log;
}
const press = (key: string) => fireEvent.keyDown(window, { key });

beforeEach(() => Object.values(toasts).forEach((f) => f.mockClear()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("ExamView: setting up", () => {
  it("picks length, difficulty and topics (suggested or typed), shows the clock it will get, and starts", async () => {
    const log = server();
    render(<ExamView documentId="d1" />);
    await screen.findByRole("heading", { name: "Mock exam" });
    fireEvent.click(screen.getByRole("button", { name: "10 questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Hard" }));
    expect(screen.getByText(/15:00/)).toBeTruthy();                              // 10 x 90 s
    fireEvent.click(screen.getByRole("button", { name: /Osmosis/ }));
    fireEvent.change(screen.getByLabelText("Add a topic"), { target: { value: "Krebs cycle" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(within(screen.getByRole("list", { name: "Chosen topics" })).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["Osmosis", "Krebs cycle"]);
    fireEvent.click(screen.getByRole("button", { name: "Start exam" }));
    await screen.findByRole("heading", { name: "Exam question 1?" });
    expect(log.creates).toEqual([{ session_id: "d1", length: 10, difficulty: "hard", topics: ["Osmosis", "Krebs cycle"] }]);
  });

  it("a plan without exam mode gets the calm upgrade card", async () => {
    server({ locked: true });
    render(<ExamView documentId="d1" />);
    expect(await screen.findByRole("heading", { name: "Exam mode comes with Sage" })).toBeTruthy();
  });
});

describe("ExamView: taking it", () => {
  it("resumes the exam in progress; keys answer, clear, flag and move; answers are saved, no feedback", async () => {
    const log = server({ active: exam() });
    render(<ExamView documentId="d1" />);
    await screen.findByRole("heading", { name: "Exam question 1?" });
    expect(screen.getByRole("timer").textContent).toContain("4:30");
    press("2");
    await waitFor(() => expect(log.answers).toEqual([{ index: 0, answer: "B0" }]));
    expect(screen.getByRole("radio", { name: /B0/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText(/correct/i)).toBeNull();                          // no hints, no verdict
    press("2");                                                                  // the same answer again clears it
    await waitFor(() => expect(log.answers[1]).toEqual({ index: 0, clear: true }));
    press("1");
    press("f");
    await waitFor(() => expect(log.answers.at(-1)).toEqual({ index: 0, flagged: true }));
    const grid = screen.getByRole("navigation", { name: "Questions" });
    expect(within(grid).getByRole("button", { name: "Question 1, answered, flagged" })).toBeTruthy();
    press("ArrowRight");
    expect(await screen.findByRole("heading", { name: "Exam question 2?" })).toBeTruthy();
    fireEvent.click(within(grid).getByRole("button", { name: "Question 3, not answered" }));
    expect(await screen.findByRole("heading", { name: "Exam question 3?" })).toBeTruthy();
  });

  it("submitting asks first (saying what is unanswered), then shows the graded results and the report", async () => {
    const log = server({ active: exam() });
    render(<ExamView documentId="d1" />);
    await screen.findByRole("heading", { name: "Exam question 1?" });
    fireEvent.click(screen.getByRole("button", { name: /^Submit$/ }));
    const dialog = await screen.findByRole("dialog", { name: "Submit your exam?" });
    expect(within(dialog).getByText(/3 of 3 questions have no answer yet/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit exam" }));
    expect(await screen.findByRole("heading", { name: "Exam results" })).toBeTruthy();
    expect(log.submits).toBe(1);
    expect(screen.getByText("Score").closest("div")!.textContent).toContain("0 / 3");
    expect(screen.getByRole("rowheader", { name: "ATP" })).toBeTruthy();
    expect(screen.getByText(/3 missed questions are now in your review queue/)).toBeTruthy();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /Save as PDF/ }));      // the browser's print: Save as PDF
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".exam-results")!.getAttribute("data-print")).toBe("report");
    expect(screen.getByRole("link", { name: "Review them" }).getAttribute("href")).toBe("/study?tab=review&doc=d1");
    expect(screen.getByText("Because 0.")).toBeTruthy();
    expect(toasts.success).toHaveBeenCalledWith("Exam complete: +150 XP | +40 Coins", expect.anything());
  });

  it("when the clock runs out the exam is handed in", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const log = server({ active: exam({ seconds_left: 2 }) });
    render(<ExamView documentId="d1" />);
    await screen.findByRole("heading", { name: "Exam question 1?" });
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    await screen.findByRole("heading", { name: "Exam results" });
    expect(log.submits).toBe(1);
    expect(toasts.info).toHaveBeenCalledWith("Time's up. Your exam was handed in.");
  });
});
