import { describe, expect, it } from "vitest";
import { greeting, lastSession, reviewProgress, todaySummary } from "./today";

const at = (h: number) => new Date(2026, 10, 6, h, 15);

describe("Today", () => {
  it("greets by the time of day", () => {
    expect(greeting(at(7))).toBe("Good morning");
    expect(greeting(at(13))).toBe("Good afternoon");
    expect(greeting(at(19))).toBe("Good evening");
    expect(greeting(at(2))).toBe("Good evening");
  });

  it("the review: what's due, how much of today is done, about how long the rest takes", () => {
    expect(reviewProgress({ due: 7, reviewed_today: 5, locked: false } as never)).toEqual({ locked: false, due: 7, done: 5, total: 12, pct: 42, minutes: 2 });
    expect(reviewProgress({ due: 0, reviewed_today: 0, locked: false } as never)).toMatchObject({ due: 0, total: 0, pct: 100, minutes: 0 });
    expect(reviewProgress({ due: 4, reviewed_today: 0, locked: true } as never).locked).toBe(true);
    expect(reviewProgress(null)).toMatchObject({ locked: false, due: 0, total: 0 });
  });

  it("continue where you left off: the latest saved session, not an arena one", () => {
    const meta = {
      a: { type: "quiz", preview: "cells · 3/5 answered", updated: "2026-11-05T10:00:00Z", title: "bio.pdf" },
      b: { type: "arena", preview: "boss", updated: "2026-11-06T10:00:00Z" },
      c: { type: "notes", preview: "key concepts", updated: "2026-11-04T10:00:00Z" },
    };
    expect(lastSession(meta)).toEqual({ id: "a", type: "quiz", label: "Quiz", preview: "cells · 3/5 answered", title: "bio.pdf" });
    expect(lastSession({})).toBeNull();
  });

  it("sums up what's left today in words (one line, so it is quick to read)", () => {
    expect(todaySummary({ due: 3, questsLeft: 2 })).toBe("Two things left today: your review and 2 quests.");
    expect(todaySummary({ due: 3, questsLeft: 0 })).toBe("One thing left today: your review.");
    expect(todaySummary({ due: 0, questsLeft: 1 })).toBe("One thing left today: 1 quest.");
    expect(todaySummary({ due: 0, questsLeft: 0 })).toBe("You're all caught up today.");
  });
});
