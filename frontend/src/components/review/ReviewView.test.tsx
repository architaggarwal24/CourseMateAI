import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { bodyOf, json, urlOf } from "@/test/sse";

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), apiError: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/components/ui/Toast", async (orig) => ({ ...(await orig<typeof import("@/components/ui/Toast")>()), toast: toasts }));
vi.mock("@/hooks/useHUD", () => ({ useHUDStore: (sel: (s: unknown) => unknown) => sel({ refreshIfStale: vi.fn() }) }));

import ReviewView from "./ReviewView";
import { useReview } from "@/hooks/useReview";

const IV = { "1": 60, "2": 330, "3": 600, "4": 8 * 86400 };
const item = (id: number, over: Record<string, unknown> = {}) => ({
  id, front: `Question ${id}?`, back: `Answer ${id}`, explanation: `Because ${id}.`, concept: "ATP", source: "arena",
  state: "new", due: "2026-11-04T09:00:00+00:00", reps: 0, lapses: 0,
  document: { session_id: "d1", name: "biology.pdf" }, intervals: IV, ...over,
});
const stats = (over: Record<string, unknown> = {}) => ({
  due: 2, learning: 0, review: 0, new: 2, new_waiting: 2, new_left_today: 20, reviewed_today: 0, total: 2,
  by_source: { flashcard: 0, arena: 2, quiz: 0, exam: 0 }, next_due_at: null, locked: false, ...over,
});

function server(opts: { queues?: unknown[][]; locked?: boolean; stale?: boolean; reward?: boolean } = {}) {
  const log = { calls: [] as string[], grades: [] as any[], deletes: [] as string[] };
  const queues = [...(opts.queues ?? [[item(1), item(2)], []])];
  let reviewed = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(urlOf(input));
    const path = url.pathname.replace("/api/v1", "");
    const method = (typeof input === "object" && "method" in input ? input.method : init?.method) ?? "GET";
    log.calls.push(`${method} ${path}${url.search}`);
    if (opts.locked) {
      return json(403, { error: { code: "feature_locked", message: "Spaced-repetition review comes with the Scholar plan.", action: null,
                                  details: { feature: "review_queue", tier: "apprentice", required_tier: "scholar", required_tier_name: "Scholar" } } });
    }
    if (path === "/review/queue") {
      const items = queues.shift() ?? [];
      return json(200, { ok: true, items, stats: stats({ due: items.length, reviewed_today: reviewed, total: items.length || reviewed ? 2 : 0 }) });
    }
    if (path === "/review/grade") {
      const body = await bodyOf(input, init);
      log.grades.push(body);
      if (opts.stale) return json(409, { error: { code: "review_stale", message: "This card was already graded.", action: null, details: null } });
      reviewed += 1;
      const last = reviewed === 2;
      return json(200, { ok: true, item: item(body.item_id, { reps: 1, state: "learning" }),
                         stats: stats({ due: 2 - reviewed, reviewed_today: reviewed }),
                         ...(opts.reward && last ? { rewards: { ok: true, xp_gained: 80, coins_gained: 20 } } : {}) });
    }
    if (path.startsWith("/review/cards/") && method === "DELETE") { log.deletes.push(path); return json(200, { ok: true }); }
    return json(404, { error: { code: "not_found", message: "nope", action: null, details: null } });
  }));
  return log;
}

const press = (key: string) => fireEvent.keyDown(window, { key });
const card = () => screen.getByTestId("review-card");

beforeEach(() => { useReview.getState().reset(); Object.values(toasts).forEach((f) => f.mockClear()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ReviewView: the daily review, keyboard first", () => {
  it("Space shows the answer; 1-4 grade it with the server, each button saying when the card comes back", async () => {
    const log = server();
    render(<ReviewView documentId="d1" />);
    expect(await screen.findByText("Question 1?")).toBeTruthy();
    expect(screen.queryByText("Answer 1")).toBeNull();
    expect(within(card()).getByText("Study scroll")).toBeTruthy();
    expect(within(card()).getByText("biology.pdf")).toBeTruthy();
    press("3");                                                                    // nothing to grade before the answer shows
    expect(log.grades).toEqual([]);

    press(" ");
    expect(screen.getByText("Answer 1")).toBeTruthy();
    expect(screen.getByText("Because 1.")).toBeTruthy();
    const grades = screen.getByRole("group", { name: "How well did you know it?" });
    expect(within(grades).getAllByRole("button").map((b) => b.textContent)).toEqual(["Again1m1", "Hard6m2", "Good10m3", "Easy8d4"]);

    press("3");
    await screen.findByText("Question 2?");
    expect(log.grades).toHaveLength(1);
    expect(log.grades[0]).toMatchObject({ item_id: 1, rating: 3, reps: 0 });
    expect(log.grades[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(useReview.getState().stats?.due).toBe(1);                               // the badge follows each grade
  });

  it("the last card leads to 'All caught up', and clearing the queue says what it earned", async () => {
    server({ reward: true });
    render(<ReviewView />);
    await screen.findByText("Question 1?");
    press(" "); press("4");
    await screen.findByText("Question 2?");
    press(" "); press("1");
    expect(await screen.findByRole("heading", { name: "All caught up" })).toBeTruthy();
    expect(screen.getByText(/You reviewed 2 cards this session/)).toBeTruthy();
    expect(toasts.success).toHaveBeenCalledWith("Review cleared: +80 XP | +20 Coins", expect.anything());
  });

  it("a card graded elsewhere (409) is skipped quietly", async () => {
    server({ stale: true });
    render(<ReviewView />);
    await screen.findByText("Question 1?");
    press(" "); press("2");
    await screen.findByText("Question 2?");
    expect(toasts.apiError).not.toHaveBeenCalled();
  });

  it("'This document' narrows the queue to the open document", async () => {
    const log = server({ queues: [[item(1)], [item(1)]] });
    render(<ReviewView documentId="d1" />);
    await screen.findByText("Question 1?");
    fireEvent.click(screen.getByRole("button", { name: /This document/ }));
    await waitFor(() => expect(log.calls).toContain("GET /review/queue?limit=20&session_id=d1"));
    expect(log.calls[0]).toBe("GET /review/queue?limit=20");
  });

  it("a card can be removed from the queue for good", async () => {
    const log = server();
    render(<ReviewView />);
    await screen.findByText("Question 1?");
    fireEvent.click(screen.getByRole("button", { name: /Remove/ }));
    await screen.findByText("Question 2?");
    expect(log.deletes).toEqual(["/review/cards/1"]);
  });
});

describe("ReviewView: other states", () => {
  it("an empty queue explains where cards come from", async () => {
    server({ queues: [[]] });
    render(<ReviewView documentId="d1" />);
    expect(await screen.findByRole("heading", { name: "Your review queue is empty" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Make flashcards/ }).getAttribute("href")).toBe("/study?tab=flashcards&doc=d1");
  });

  it("a plan without the review queue gets a calm upgrade card, not an error", async () => {
    server({ locked: true });
    render(<ReviewView />);
    expect(await screen.findByRole("heading", { name: "Spaced-repetition review comes with Scholar" })).toBeTruthy();
    expect(screen.getByText("Scholar plan")).toBeTruthy();
    expect(toasts.apiError).not.toHaveBeenCalled();
  });
});
