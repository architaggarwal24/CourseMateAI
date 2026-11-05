/** @vitest-environment node */
// Stage 4.6: the Python backend is gone. An /api path no route answers is a JSON 404, never a forward.
import { describe, expect, it, vi } from "vitest";
import * as catchAll from "@/app/api/[...path]/route";

describe("/api/* with no route", () => {
  it("answers 404 not_found as JSON for every method and calls nobody", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = catchAll[m]();
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect((await res.json()).error.code).toBe("not_found");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
