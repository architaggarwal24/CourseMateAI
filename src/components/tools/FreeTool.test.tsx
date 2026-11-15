import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import FreeTool from "./FreeTool";
import RevisionPlanner from "./RevisionPlanner";

const answer = (body: unknown, status = 200) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("a free tool", () => {
  it("runs on sample notes and shows flashcards that flip, then the invitation and the runs left", async () => {
    const fetcher = answer({ tool: "flashcards", cards: [{ front: "What is chlorophyll?", back: "The green pigment that absorbs light." }], remaining: 4 });
    vi.stubGlobal("fetch", fetcher);
    render(<FreeTool kind="flashcards" />);
    const make = screen.getByRole("button", { name: /Make flashcards/ });
    expect(make).toHaveProperty("disabled", true);                       // nothing pasted yet
    fireEvent.click(screen.getByRole("button", { name: "Try sample notes" }));
    fireEvent.click(make);
    const card = await screen.findByRole("button", { name: /What is chlorophyll\?/ });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ tool: "flashcards" });
    fireEvent.click(card);
    expect(card.textContent).toContain("The green pigment that absorbs light.");
    expect(screen.getByRole("link", { name: "Start studying free" }).getAttribute("href")).toBe("/login?mode=register");
    expect(screen.getByText("4 free runs left today")).toBeTruthy();
  });

  it("a quiz marks each answer and gives the score at the end", async () => {
    vi.stubGlobal("fetch", answer({ tool: "quiz", questions: [{ question: "Where?", options: ["Roots", "Leaves", "Stem", "Flowers"], answer: 1, explanation: "Leaves hold the chloroplasts." }], remaining: 3 }));
    render(<FreeTool kind="quiz" />);
    fireEvent.click(screen.getByRole("button", { name: "Try sample notes" }));
    fireEvent.click(screen.getByRole("button", { name: /Make a quiz/ }));
    const options = await screen.findByRole("group", { name: "Question 1 options" });
    fireEvent.click(within(options).getByRole("button", { name: "Roots" }));
    expect(screen.getByText(/Not quite\. Leaves hold the chloroplasts\./)).toBeTruthy();
    expect(screen.getByText("You got 0 of 1 right.")).toBeTruthy();
  });

  it("shows the server's reason when a run is refused (the daily limit)", async () => {
    vi.stubGlobal("fetch", answer({ error: { code: "rate_limited", message: "You've used today's 5 free runs." } }, 429));
    render(<FreeTool kind="summary" />);
    fireEvent.click(screen.getByRole("button", { name: "Try sample notes" }));
    fireEvent.click(screen.getByRole("button", { name: /Summarise/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("today's 5 free runs"));
  });
});

describe("the revision planner", () => {
  it("makes a day-by-day plan in the browser, with no request", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<RevisionPlanner />);
    const inTwoMonths = new Date(); inTwoMonths.setDate(inTwoMonths.getDate() + 60);
    const iso = `${inTwoMonths.getFullYear()}-${String(inTwoMonths.getMonth() + 1).padStart(2, "0")}-${String(inTwoMonths.getDate()).padStart(2, "0")}`;
    fireEvent.change(screen.getByLabelText("Exam date"), { target: { value: iso } });
    fireEvent.click(screen.getByRole("button", { name: "Use Class 10 Science chapters" }));
    fireEvent.click(screen.getByRole("button", { name: /Make my plan/ }));
    const plan = screen.getByRole("list", { name: "Your revision plan" });
    expect(within(plan).getAllByRole("listitem")).toHaveLength(60);
    expect(plan.textContent).toContain("Study: Chemical Reactions and Equations");
    expect(plan.textContent).toContain("Mock test");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
