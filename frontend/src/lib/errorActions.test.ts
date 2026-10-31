import { describe, expect, it } from "vitest";
import { ApiError, parseApiError } from "@/lib/api/errors";
import { DEFAULT_RETRY_AFTER, NETWORK_ERROR_MESSAGE, describeError, withoutActions } from "./errorActions";

const err = (status: number, code: string, message: string, action: string | null = null, details: object | null = null, retryAfterHeader?: string) =>
  parseApiError(status, { error: { code, message, action, details } }, undefined, retryAfterHeader);

describe("describeError: the button each error code calls for", () => {
  it("provider_key_rejected -> Open Settings (a link to Settings)", () => {
    const info = describeError(err(400, "provider_key_rejected", "Your API key was rejected.", "settings"));
    expect(info.action).toMatchObject({ kind: "settings", label: "Open Settings", href: "/account/settings" });
    expect(info.message).toBe("Your API key was rejected.");
  });

  it("provider_quota -> the provider's usage page, in a new tab; Settings when it named none", () => {
    const withUrl = describeError(err(429, "provider_quota", "Quota.", "settings", { usage_url: "https://aistudio.google.com/usage", provider: "gemini" }));
    expect(withUrl.action).toMatchObject({ kind: "usage", label: "Check usage", href: "https://aistudio.google.com/usage", external: true });
    expect(describeError(err(429, "provider_quota", "Quota.", "settings")).action?.kind).toBe("settings");
  });

  it("provider_unreachable -> Retry", () => {
    expect(describeError(err(502, "provider_unreachable", "Down.", "retry")).action).toMatchObject({ kind: "retry", label: "Retry" });
  });

  it("session_expired -> Re-upload", () => {
    expect(describeError(err(400, "session_expired", "Gone.", "reupload")).action).toMatchObject({ kind: "reupload", label: "Re-upload" });
  });

  it("unauthenticated -> Log in (a link to /login)", () => {
    expect(describeError(err(401, "unauthenticated", "Please log in.", "relogin")).action)
      .toMatchObject({ kind: "login", label: "Log in", href: "/login" });
  });

  it("rate_limited -> Retry with the wait from details, else the Retry-After header, else a default", () => {
    const fromDetails = describeError(err(429, "rate_limited", "Slow down.", "retry", { retry_after_seconds: 30 }));
    expect([fromDetails.action?.kind, fromDetails.retryAfter]).toEqual(["retry", 30]);
    expect(describeError(err(429, "rate_limited", "Slow down.", "retry", null, "12")).retryAfter).toBe(12);
    expect(describeError(err(429, "rate_limited", "Slow down.", "retry")).retryAfter).toBe(DEFAULT_RETRY_AFTER);
  });

  it("a 429 with no error body is treated as rate_limited", () => {
    const info = describeError(parseApiError(429, null, undefined, "7"));
    expect([info.code, info.action?.kind, info.retryAfter]).toEqual(["rate_limited", "retry", 7]);
  });

  it("other codes follow the server's action field, and no action means no button", () => {
    expect(describeError(err(400, "document_not_ready", "Wait.", "retry")).action?.kind).toBe("retry");
    expect(describeError(err(400, "document_failed", "Bad file.", "reupload")).action?.kind).toBe("reupload");
    expect(describeError(err(400, "provider_settings_invalid", "Fix.", "settings")).action?.kind).toBe("settings");
    expect(describeError(err(422, "invalid_input", "Bad input.")).action).toBeNull();
  });

  it("an error that never got an answer is 'couldn't reach the server' + Retry, never the browser's raw text", () => {
    const info = describeError(new TypeError("Failed to fetch"));
    expect([info.code, info.message, info.action?.kind]).toEqual(["network_error", NETWORK_ERROR_MESSAGE, "retry"]);
    expect(describeError(new TypeError("x"), "Nothing was saved.").message).toBe("Nothing was saved.");
    expect(describeError(null).action?.kind).toBe("retry");
  });

  it("withoutActions drops a button the screen is already on", () => {
    const info = describeError(err(400, "provider_key_rejected", "Rejected.", "settings"));
    expect(withoutActions(info, ["settings"]).action).toBeNull();
    expect(withoutActions(info, ["retry"]).action?.kind).toBe("settings");
    expect(info).toBeInstanceOf(Object);
    expect(new ApiError(400, { code: "x", message: "m", action: null, details: null }).retryAfter).toBeNull();
  });
});
