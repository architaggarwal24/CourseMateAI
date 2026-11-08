// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasSessionCookie, safeNext } from "./session-cookie";

describe("the session cookie and where to go after signing in", () => {
  it("sees either cookie name", () => {
    expect(hasSessionCookie((n) => (n === "__Secure-coursemate.session_token" ? { value: "x" } : undefined))).toBe(true);
    expect(hasSessionCookie((n) => (n === "coursemate.session_token" ? { value: "x" } : undefined))).toBe(true);
    expect(hasSessionCookie(() => undefined)).toBe(false);
    expect(hasSessionCookie(() => ({ value: "" }))).toBe(false);
  });

  it("only follows internal app paths", () => {
    expect(safeNext("/study?tab=quiz&doc=d1", "/today")).toBe("/study?tab=quiz&doc=d1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/login?next=/x", "/", "", null, "/a\nb"]) {
      expect(safeNext(bad, "/today")).toBe("/today");
    }
  });
});
