/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { missingTableHint, toResponse } from "./http";

afterEach(() => vi.restoreAllMocks());

describe("an empty database", () => {
  // A fresh clone has an empty local D1: every query fails with "no such table". Say what to run, once, in plain words.
  it("is recognised anywhere in the error's causes, and the log says which command fixes it", () => {
    const d1 = new Error("Failed query: select ... from \"session\"", { cause: new Error("D1_ERROR: no such table: session: SQLITE_ERROR") });
    expect(missingTableHint(d1, "development")).toMatch(/npm run db:migrate:local/);
    expect(missingTableHint(d1, "production")).toMatch(/npm run db:migrate:remote/);
    expect(missingTableHint(new Error("something else"), "development")).toBeNull();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(toResponse(d1).status).toBe(500);
    expect(logged.mock.calls.flat().join(" ")).toMatch(/db:migrate/);
  });
});
