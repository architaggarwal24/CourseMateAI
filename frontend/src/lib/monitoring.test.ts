import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/browser";
import { initMonitoring, scrubEvent } from "./monitoring";

describe("error reports carry no secrets", () => {
  it("drops request details and the user's email, and redacts key-shaped text", () => {
    const event = {
      request: { url: "https://app.example/study?tab=chat&doc=abc", method: "GET", headers: { Cookie: "session_token=x" }, cookies: { a: "b" } },
      user: { id: "7", email: "a@b.c", ip_address: "1.2.3.4" },
      exception: { values: [{ type: "Error", value: "key sk-proj-ABCDEFGHIJKLMNOPQRSTUV refused, AIzaSyA1234567890abcdefghijklmnop" }] },
      extra: { apiKey: "whatever", note: "ok" },
      breadcrumbs: [{ category: "fetch", data: { url: "/api/v1/documents/abc?token=1" }, message: "Bearer abc.def" }],
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.request).toEqual({ url: "https://app.example/study", method: "GET" });
    expect(out.user).toEqual({ id: "7" });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/sk-proj-ABC|AIzaSy|Bearer abc|token=1/);
    expect(out.extra).toEqual({ apiKey: "[redacted]", note: "ok" });
  });

  it("stays off without a DSN", async () => {
    expect(await initMonitoring()).toBe(false);
  });
});
