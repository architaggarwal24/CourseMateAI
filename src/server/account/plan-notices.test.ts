/** @vitest-environment node */
// "You've been upgraded": which plan changes deserve the window, and the admin's note.
import { describe, expect, it } from "vitest";
import { NOTE_MAX, cleanNote, noticeKind } from "./plan-notices";

const free = { tier: "apprentice" as const, expiresAt: null };
const scholar = (expiresAt: string | null) => ({ tier: "scholar" as const, expiresAt });

describe("noticeKind", () => {
  it("a higher plan is an upgrade, from anything", () => {
    expect(noticeKind(free, scholar("2027-01-01T00:00:00Z"), true)).toBe("upgrade");
    expect(noticeKind(scholar(null), { tier: "archmage", expiresAt: "2026-12-01T00:00:00Z" }, false)).toBe("upgrade");
  });
  it("the same paid plan for longer is an extension, only where extensions count (not a payment's renewal)", () => {
    expect(noticeKind(scholar("2027-01-01T00:00:00Z"), scholar("2027-02-01T00:00:00Z"), true)).toBe("extend");
    expect(noticeKind(scholar("2027-01-01T00:00:00Z"), scholar(null), true)).toBe("extend");
    expect(noticeKind(scholar("2027-01-01T00:00:00Z"), scholar("2027-02-01T00:00:00Z"), false)).toBeNull();
  });
  it("shorter, the same, lower or Free is nothing", () => {
    expect(noticeKind(scholar("2027-02-01T00:00:00Z"), scholar("2027-01-01T00:00:00Z"), true)).toBeNull();
    expect(noticeKind(scholar(null), scholar("2030-01-01T00:00:00Z"), true)).toBeNull();
    expect(noticeKind(scholar(null), scholar(null), true)).toBeNull();
    expect(noticeKind(scholar(null), free, true)).toBeNull();
    expect(noticeKind(free, free, true)).toBeNull();
  });
});

describe("cleanNote", () => {
  it("trims, squashes spaces, caps the length, and empty is no note", () => {
    expect(cleanNote("  Thanks\n\nfor   testing  ")).toBe("Thanks for testing");
    expect(cleanNote("x".repeat(NOTE_MAX + 50))).toHaveLength(NOTE_MAX);
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(42)).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
  });
});
