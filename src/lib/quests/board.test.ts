import { describe, expect, it } from "vitest";
import { DAILY_CALL, callHref, dailyScroll } from "./board";

// Stage Q1: "Answer the call" opens the exact place a quest is done.
describe("the quest board's links", () => {
  it("each place has its link; a hunt fills its topic in the arena", () => {
    expect(callHref({ place: "arena", topic: "graph algorithms" })).toBe("/arena?topic=graph%20algorithms");
    expect(callHref({ place: "arena" })).toBe("/arena");
    expect(callHref({ place: "review" })).toBe("/study?tab=review");
    expect(callHref({ place: "bestiary" })).toBe("/bestiary");
    expect(callHref(undefined)).toBe("/today");
  });

  it("every daily quest has a place, and becomes a scroll", () => {
    for (const t of ["ask_questions", "complete_quizzes", "maintain_streak", "review_cards", "generate_notes", "perfect_quiz", "clear_reviews",
      "arena_rounds", "defeat_boss", "quiz_master", "complete_exams", "quiz_perfectionist", "notes_scholar", "study_flashcards"]) expect(DAILY_CALL[t], t).toBeDefined();
    expect(dailyScroll({ quest_type: "complete_quizzes", description: "Complete 3 quizzes", target_count: 3, current_count: 5, reward_xp: 60, reward_coins: 30, completed: 1, claimed: 0 }))
      .toEqual({ id: "daily:complete_quizzes", kind: "daily", title: "Complete 3 quizzes", text: "", target: 3, progress: 3, completed: true, claimed: false,
        reward: { xp: 60, coins: 30 }, call: { place: "quiz" } });
  });
});
