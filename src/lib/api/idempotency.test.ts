import { afterEach, describe, expect, it, vi } from "vitest";
import { json, urlOf } from "@/test/sse";
import { idempotencyKey } from "./idempotency";
import { startExam } from "@/lib/study/exam";
import { createCourse } from "@/lib/study/courses";
import { startCheckout } from "@/lib/account/billing";
import { adminApi } from "@/lib/admin/admin-api";

afterEach(() => vi.unstubAllGlobals());

const keyOf = (input: RequestInfo | URL, init?: RequestInit) =>
  (input instanceof Request ? input.headers : new Headers(init?.headers)).get("Idempotency-Key");

describe("idempotencyKey", () => {
  it("one key per action: the same until it succeeds (so a retry reuses it), then a new one", () => {
    const a = idempotencyKey("courses", { name: "Bio" });
    expect(a.headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9_-]{16,128}$/);    // the server's accepted shape
    expect(idempotencyKey("courses", { name: "Bio" }).headers).toEqual(a.headers);          // retry: same key
    expect(idempotencyKey("courses", { name: "Chem" }).headers).not.toEqual(a.headers);     // other input: other key
    expect(idempotencyKey("exams", { name: "Bio" }).headers).not.toEqual(a.headers);        // other action
    a.done();
    expect(idempotencyKey("courses", { name: "Bio" }).headers).not.toEqual(a.headers);     // the next action
  });
});

describe("record-creating calls send an Idempotency-Key", () => {
  it("and a retry after a failure (a timeout, a 5xx) sends the same key; after success the next call gets a new one", async () => {
    const keys: (string | null)[] = [];
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      keys.push(keyOf(input, init));
      if (fail) { fail = false; return json(503, { error: { code: "busy", message: "busy", action: "retry" } }); }
      return json(200, urlOf(input).endsWith("/courses") ? { id: 1, name: "Bio" } : { id: "e1" });
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(createCourse("Bio", ["d1"])).rejects.toBeTruthy();
    await createCourse("Bio", ["d1"]);
    await createCourse("Bio", ["d1"]);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("on exams, checkout and admin invite codes too", async () => {
    const seen: Record<string, string | null> = {};
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen[new URL(urlOf(input), "http://x").pathname] = keyOf(input, init);
      return json(200, {});
    }));
    await startExam("s1", 10, "mixed", []);
    await startCheckout("scholar", "month");
    await adminApi.createInvite({ tier: "scholar", days: 30, max_uses: 1, valid_days: null });
    expect(seen["/api/v1/exams"]).toBeTruthy();
    expect(seen["/api/v1/billing/checkout"]).toBeTruthy();
    expect(seen["/api/v1/admin/invites"]).toBeTruthy();
  });
});
