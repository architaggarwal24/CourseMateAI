import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { activeSession, forgetSession, loadDraft, rememberSession, saveDraft, useDraft } from "./memory";

beforeEach(() => localStorage.clear());

describe("study memory", () => {
  it("remembers each tool's open session per course or PDF, while that session is still saved", () => {
    localStorage.setItem("cmai_session_n1", JSON.stringify({ notes: "x" }));
    rememberSession("notes", "course-1", "n1");
    rememberSession("notes", "course-2", "gone");
    expect(activeSession("notes", "course-1")).toBe("n1");
    expect(activeSession("chat", "course-1")).toBeUndefined();          // per tool
    expect(activeSession("notes", "course-2")).toBeUndefined();         // deleted from History: nothing to reopen
    expect(activeSession("notes", undefined)).toBeUndefined();
    forgetSession("notes", "course-1");
    expect(activeSession("notes", "course-1")).toBeUndefined();
  });

  it("keeps what was typed until it is cleared", () => {
    saveDraft("chat", "c1", "what is PCA");
    expect(loadDraft("chat", "c1")).toBe("what is PCA");
    expect(loadDraft("chat", "c2")).toBe("");
    saveDraft("chat", "c1", "  ");
    expect(localStorage.getItem("cmai_draft_chat_c1")).toBeNull();
  });

  it("useDraft starts from the saved text, saves changes, and a passed-in topic wins", () => {
    saveDraft("quiz", "c1", "clustering");
    const { result, unmount } = renderHook(() => useDraft("quiz", "c1"));
    expect(result.current[0]).toBe("clustering");
    act(() => result.current[1]("k-means"));
    expect(loadDraft("quiz", "c1")).toBe("k-means");
    unmount();
    const fromMap = renderHook(() => useDraft("quiz", "c1", "DBSCAN"));
    expect(fromMap.result.current[0]).toBe("DBSCAN");
  });
});
