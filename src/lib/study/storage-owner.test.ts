import { afterEach, describe, expect, it } from "vitest";
import { claimStudyStorage, clearStudyStorage } from "./sessions";

// Security audit run 1: study sessions live in this browser's localStorage, so they must never outlast the account
// that wrote them on a shared computer.
afterEach(() => localStorage.clear());

const seed = () => {
  localStorage.setItem("cmai_metadata", "{}");
  localStorage.setItem("cmai_session_chat-a", "[]");
  localStorage.setItem("cmai_active_chat_doc-a", "chat-a");
  localStorage.setItem("cmai_draft_chat_doc-a", "half a question");
  localStorage.setItem("cmai_arena_session", "{}");
  localStorage.setItem("cmai_appearance", '{"theme":"dark"}');                    // a device setting: stays
  localStorage.setItem("other_app", "x");
};

describe("study storage belongs to one account", () => {
  it("clearStudyStorage removes every study key and keeps device settings", () => {
    seed();
    clearStudyStorage();
    expect(Object.keys(localStorage).sort()).toEqual(["cmai_appearance", "other_app"]);
  });

  it("a different account signing in on this browser starts empty; the same account keeps its sessions", () => {
    seed();
    claimStudyStorage("1");
    expect(localStorage.getItem("cmai_session_chat-a")).toBe("[]");              // first claim keeps what's there
    claimStudyStorage("1");
    expect(localStorage.getItem("cmai_session_chat-a")).toBe("[]");
    claimStudyStorage("2");
    expect(localStorage.getItem("cmai_session_chat-a")).toBeNull();
    expect(localStorage.getItem("cmai_appearance")).toBe('{"theme":"dark"}');
  });
});
