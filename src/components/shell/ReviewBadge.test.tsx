import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/study", useSearchParams: () => new URLSearchParams() }));
import BottomNav from "./BottomNav";
import { useReview } from "@/hooks/useReview";

afterEach(() => { cleanup(); useReview.getState().reset(); });

const stats = (due: number, locked = false) => ({ due, learning: 0, review: due, new: 0, new_waiting: 0, new_left_today: 20,
  reviewed_today: 0, total: due, by_source: {}, next_due_at: null, locked });

describe("the Review nav item carries the review queue's due count", () => {
  it("shows the count, said in words for screen readers, and hides at zero or when reviewing is locked", () => {
    render(<BottomNav />);
    expect(screen.queryByTestId("review-badge")).toBeNull();
    act(() => useReview.getState().setStats(stats(7)));
    const review = screen.getByRole("link", { name: /Review/ });
    expect(review.textContent).toContain("7");
    expect(review.textContent).toContain("7 cards to review");
    act(() => useReview.getState().setStats(stats(120)));
    expect(screen.getByTestId("review-badge").textContent).toContain("99+");
    act(() => useReview.getState().setStats(stats(5, true)));
    expect(screen.queryByTestId("review-badge")).toBeNull();
    act(() => useReview.getState().setStats(stats(0)));
    expect(screen.queryByTestId("review-badge")).toBeNull();
  });
});
