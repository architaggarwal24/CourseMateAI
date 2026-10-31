import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { bodyOf, json, urlOf } from "@/test/sse";
import { saveSessionData } from "@/lib/sessions";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn() }));
vi.mock("@/hooks/useHUD", () => ({ useHUDStore: (sel: (s: unknown) => unknown) => sel({ refreshIfStale: vi.fn() }) }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));

import FlashcardView from "@/components/FlashcardView";

const DECK = [
  { id: 1, front: "What is ATP?", back: "The cell's energy currency.", topic: "Cells", difficulty: "easy" },
  { id: 2, front: "Where is DNA kept?", back: "In the nucleus.", topic: "Cells", difficulty: "medium" },
  { id: 3, front: "What is osmosis?", back: "Water moving across a membrane.", topic: "Cells", difficulty: "hard" },
];
const SAVED = "deck-1";

const key = (k: string, target: Element | Window = window) => fireEvent.keyDown(target, { key: k });
const card = () => screen.getByRole("button", { name: /^(Question|Answer):/ });
const position = () => screen.getByText(/^Card \d of \d$/).textContent;

beforeEach(() => {
  localStorage.clear();
  Object.values(toasts).forEach((f) => f.mockClear());
  saveSessionData(SAVED, "flashcards", "cells · 1/3", { cards: DECK, results: {}, currentIndex: 0, topic: "cells" }, "cells");
  vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("FlashcardView: keyboard alone", () => {
  it("Space turns the card over and back; the card says which side is showing", () => {
    render(<FlashcardView restoreSessionId={SAVED} />);
    expect(position()).toBe("Card 1 of 3");
    expect(card().getAttribute("aria-label")).toContain("Question: What is ATP?");
    expect(card().getAttribute("aria-pressed")).toBe("false");

    key(" ");
    expect(card().getAttribute("aria-pressed")).toBe("true");
    expect(card().getAttribute("aria-label")).toContain("Answer: The cell's energy currency.");

    key(" ");
    expect(card().getAttribute("aria-pressed")).toBe("false");
  });

  it("the card is reachable by Tab and Enter turns it over too", () => {
    render(<FlashcardView restoreSessionId={SAVED} />);
    expect(card().getAttribute("tabindex")).toBe("0");
    card().focus();
    key("Enter", card());
    expect(card().getAttribute("aria-pressed")).toBe("true");
  });

  it("the arrow keys move between cards, showing each question side first, and stop at the ends", () => {
    render(<FlashcardView restoreSessionId={SAVED} />);
    key("ArrowLeft");
    expect(position()).toBe("Card 1 of 3");                               // nothing before the first card
    key(" ");                                                             // answer showing...
    key("ArrowRight");
    expect(position()).toBe("Card 2 of 3");
    expect(card().getAttribute("aria-pressed")).toBe("false");            // ...the next card starts on its question
    expect(card().getAttribute("aria-label")).toContain("Where is DNA kept?");
    key("ArrowRight"); key("ArrowRight");
    expect(position()).toBe("Card 3 of 3");                               // nothing after the last
    key("ArrowLeft");
    expect(position()).toBe("Card 2 of 3");
  });

  it("marks a card with the keyboard: Tab to 'Got it' (hidden until the answer shows), activate it, and the deck moves on to the end", async () => {
    render(<FlashcardView restoreSessionId={SAVED} />);
    const gotIt = screen.getByRole("button", { name: "Got it" });
    expect(gotIt.parentElement!.className).toContain("invisible");        // out of sight and out of the Tab order until flipped
    key(" ");
    expect(gotIt.parentElement!.className).not.toContain("invisible");

    gotIt.focus();
    key(" ", gotIt);                                                      // Space on a focused button is the button's, not a flip
    expect(card().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(gotIt);                                               // what Enter/Space do on a button
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(position()).toBe("Card 2 of 3");

    key(" "); fireEvent.click(screen.getByRole("button", { name: "Missed it" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    key(" "); fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });

    expect(screen.getByRole("heading", { name: "Session complete" })).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();                         // 2 of 3
    expect(screen.getByRole("button", { name: "Review 1 missed card" })).toBeTruthy();
  });

  it("leaves the keys alone while a field has the keyboard (the setup form's slider uses the arrows)", () => {
    render(<FlashcardView />);
    const slider = screen.getByRole("slider");
    key("ArrowRight", slider);
    key(" ", slider);
    expect(screen.queryByText(/Card \d of/)).toBeNull();                  // still on the setup screen, nothing happened
  });
});

describe("FlashcardView: what each side shows", () => {
  it("shows difficulty as text, and a card's result as an icon with text, not colour alone", async () => {
    render(<FlashcardView restoreSessionId={SAVED} />);
    expect(screen.getByText("easy")).toBeTruthy();
    key(" "); fireEvent.click(screen.getByRole("button", { name: "Missed it" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    key("ArrowLeft");
    expect(screen.getByText("Missed").closest("div")!.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Missed: 1")).toBeTruthy();
  });
});

describe("FlashcardView: generating a deck", () => {
  it("builds cards from the server's answer and shows the first", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(new URL(urlOf(input)).pathname.endsWith("/flashcards")).toBe(true);
      expect(await bodyOf(input, init)).toMatchObject({ topic: "cells", num_cards: 10 });
      return json(200, { mode: "flashcards", cards: DECK, sources: [], rewards: null });
    }));
    render(<FlashcardView documentId="d1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "cells" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate 10 cards" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(position()).toBe("Card 1 of 3");
  });

  it("says so in a toast and lets the user try again when generation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, { error: { code: "internal", message: "The AI request failed.", action: "retry", details: null } })));
    render(<FlashcardView documentId="d1" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "cells" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate 10 cards" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(toasts.apiError).toHaveBeenCalledWith(expect.objectContaining({ code: "internal", message: "The AI request failed." }), { onRetry: expect.any(Function) });
    expect((screen.getByRole("button", { name: "Generate 10 cards" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
