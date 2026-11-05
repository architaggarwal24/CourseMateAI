import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/today" }));
const auth = vi.hoisted(() => ({ user: { user_id: 1, full_name: "Archit Aggarwal", username: "archit" } as Record<string, unknown> | null, loading: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

import TodayView from "./TodayView";
import { useReview } from "@/hooks/useReview";
import { useHUDStore } from "@/hooks/useHUD";
import { useSessionStore } from "@/hooks/useSessions";
import { useCourses } from "@/hooks/useCourses";
import { saveMetadata } from "@/lib/sessions";

const doc = (id: string, filename: string, last: string) => ({ id, filename, status: "ready", chunks: 10, kind: "document", last_used_at: last }) as never;

beforeEach(() => {
  localStorage.clear();
  auth.user = { user_id: 1, full_name: "Archit Aggarwal", username: "archit" };
  useReview.setState({ stats: { due: 7, reviewed_today: 5, locked: false } as never });
  useHUDStore.setState({ guestMode: false, level: 7, coins: 1240, xpInto: 150, xpToNext: 400, streakDays: 6, streakFreezes: 1,
    quests: [{ quest_type: "chat", title: "Ask 10 questions", current_count: 10, target_count: 10, completed: true },
      { quest_type: "quiz", title: "Complete 3 quizzes", current_count: 1, target_count: 3, completed: false }], refresh: vi.fn() } as never);
  useSessionStore.setState({ documentsOwner: "1", documentsLoaded: true, loadDocuments: vi.fn(async () => {}),
    documents: { d1: doc("d1", "Mitosis.pdf", "2026-11-05T10:00:00Z"), d2: doc("d2", "Enzymes.pdf", "2026-11-04T10:00:00Z") } } as never);
  useCourses.setState({ loaded: true, locked: false, courses: [], load: vi.fn(async () => {}) } as never);
  saveMetadata({ q1: { type: "quiz", preview: "cells · 3/5 answered", updated: "2026-11-05T09:00:00Z", title: "Mitosis.pdf" } as never });
});
afterEach(cleanup);

describe("Today", () => {
  it("greets you by first name and says in one line what is left", () => {
    render(<TodayView />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Archit$/);
    expect(screen.getByText("Two things left today: your review and 1 quest.")).toBeTruthy();
  });

  it("puts the review first, the one filled card: what's due, how far through today, and the way in", () => {
    render(<TodayView />);
    const review = screen.getByRole("region", { name: "Review" });
    expect(review.getAttribute("data-emphasis")).toBe("true");
    expect(review.textContent).toContain("7");
    expect(review.textContent).toContain("5 of 12 done today");
    expect(within(review).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
    expect(within(review).getByRole("link", { name: "Start review" }).getAttribute("href")).toBe("/study?tab=review");
  });

  it("says when the review is done, and offers the plan when the plan has none", () => {
    useReview.setState({ stats: { due: 0, reviewed_today: 12, locked: false } as never });
    const { unmount } = render(<TodayView />);
    expect(within(screen.getByRole("region", { name: "Review" })).getByText("All caught up")).toBeTruthy();
    unmount();
    useReview.setState({ stats: { due: 3, reviewed_today: 0, locked: true } as never });
    render(<TodayView />);
    expect(within(screen.getByRole("region", { name: "Review" })).getByRole("link", { name: /See plans/ })).toBeTruthy();
  });

  it("continues where you left off, from your last session in this browser", () => {
    render(<TodayView />);
    const card = screen.getByRole("region", { name: "Continue" });
    expect(card.textContent).toContain("Quiz");
    expect(card.textContent).toContain("cells · 3/5 answered");
    expect(within(card).getByRole("link", { name: /Continue/ }).getAttribute("href")).toBe("/study?tab=quiz&session=q1");
  });

  it("with no saved session, it opens your latest PDF instead", () => {
    localStorage.clear();
    render(<TodayView />);
    expect(within(screen.getByRole("region", { name: "Continue" })).getByRole("link").getAttribute("href")).toBe("/study?tab=chat&doc=d1");
  });

  it("shows the streak, the quests, your level and coins, and your PDFs", () => {
    render(<TodayView />);
    expect(screen.getByRole("region", { name: "Streak" }).textContent).toContain("6-day streak");
    const quests = screen.getByRole("region", { name: "Daily quests" });
    expect(quests.textContent).toContain("1 of 2 done");
    expect(within(quests).getByRole("link").getAttribute("href")).toBe("/hero?tab=quests");
    const hero = screen.getByRole("region", { name: "Hero" });
    expect(hero.textContent).toContain("Lv 7");
    expect(hero.textContent).toContain("1,240");
    const pdfs = within(screen.getByRole("region", { name: "Your PDFs" })).getAllByRole("link");
    expect(pdfs.map((a) => a.textContent)).toEqual([expect.stringContaining("Mitosis.pdf"), expect.stringContaining("Enzymes.pdf")]);
    expect(screen.getByRole("button", { name: /Add a PDF/ })).toBeTruthy();
  });

  it("sends a visitor who isn't signed in to log in", () => {
    auth.user = null;
    render(<TodayView />);
    expect(nav.replace).toHaveBeenCalledWith("/login");
  });
});
