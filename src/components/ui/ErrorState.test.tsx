import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApiError, parseApiError } from "@/lib/api/errors";
import ErrorState from "./ErrorState";
import { ToastHost, toast } from "./Toast";

const apiErr = (status: number, code: string, message: string, action: string | null, details: object | null = null, header?: string) =>
  parseApiError(status, { error: { code, message, action, details } }, undefined, header);

/** One row per error code: what is raised, the button it must show, and where that button leads (if it is a link). */
interface Case { code: string; make: () => Error; button: string; href?: string; callback?: "onRetry" | "onReupload" }
const CASES: Case[] = [
  { code: "provider_key_rejected", make: () => apiErr(400, "provider_key_rejected", "Your API key was rejected.", "settings"),
    button: "Open Settings", href: "/account/settings" },
  { code: "provider_quota", make: () => apiErr(429, "provider_quota", "You have used up your quota.", "settings",
      { usage_url: "https://aistudio.google.com/usage", provider: "gemini" }), button: "Check usage", href: "https://aistudio.google.com/usage" },
  { code: "provider_unreachable", make: () => apiErr(502, "provider_unreachable", "The provider can't be reached.", "retry"),
    button: "Retry", callback: "onRetry" },
  { code: "session_expired", make: () => apiErr(400, "session_expired", "Your document has expired.", "reupload"),
    button: "Re-upload", callback: "onReupload" },
  { code: "unauthenticated", make: () => apiErr(401, "unauthenticated", "Please log in.", "relogin"),
    button: "Log in", href: "/login" },
  { code: "network_error", make: () => new TypeError("Failed to fetch"), button: "Retry", callback: "onRetry" },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => { act(() => toast.dismiss()); cleanup(); vi.useRealTimers(); });

describe.each(["inline ErrorState", "toast.apiError"] as const)("%s", (surface) => {
  const show = (error: unknown, handlers: { onRetry?: () => void; onReupload?: () => void } = {}) => {
    if (surface === "inline ErrorState") render(<ErrorState error={error} {...handlers} />);
    else { render(<ToastHost />); act(() => { toast.apiError(error, handlers); }); }
  };

  it.each(CASES)("$code offers '$button'", (c) => {
    const onRetry = vi.fn(), onReupload = vi.fn();
    show(c.make(), { onRetry, onReupload });
    const alert = screen.getByRole("alert");
    if (c.code !== "network_error") expect(alert.textContent).toContain((c.make() as Error).message);
    const control = screen.getByRole(c.href ? "link" : "button", { name: c.button });
    if (c.href) {
      expect(control.getAttribute("href")).toBe(c.href);
      if (c.code === "provider_quota") expect(control.getAttribute("target")).toBe("_blank");
    } else {
      fireEvent.click(control);
      expect(c.callback === "onRetry" ? onRetry : onReupload).toHaveBeenCalledTimes(1);
      expect(c.callback === "onRetry" ? onReupload : onRetry).not.toHaveBeenCalled();
    }
  });

  it("rate_limited counts down from Retry-After, then enables Retry", () => {
    const onRetry = vi.fn();
    show(apiErr(429, "rate_limited", "Too many requests.", "retry", null, "3"), { onRetry });
    const waiting = screen.getByRole("button", { name: /Retry in 3s/ }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByRole("button", { name: /Retry in 2s/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Retry in 2s/ }));
    expect(onRetry).not.toHaveBeenCalled();                         // still counting
    act(() => { vi.advanceTimersByTime(2100); });
    const ready = screen.getByRole("button", { name: "Retry" }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
    fireEvent.click(ready);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("rate_limited uses details.retry_after_seconds when the header is absent", () => {
    show(apiErr(429, "rate_limited", "Too many requests.", "retry", { retry_after_seconds: 9 }), { onRetry: vi.fn() });
    expect(screen.getByRole("button", { name: /Retry in 9s/ })).toBeTruthy();
  });

  it("Re-upload without a handler goes to the Study page", () => {
    show(apiErr(400, "session_expired", "Gone.", "reupload"));
    expect(screen.getByRole("link", { name: "Re-upload" }).getAttribute("href")).toBe("/study");
  });

  it("an error with no action shows the message and no button", () => {
    show(apiErr(422, "invalid_input", "That input is not valid.", null), { onRetry: vi.fn() });
    expect(screen.getByRole("alert").textContent).toContain("That input is not valid.");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never shows a browser's raw error text", () => {
    show(new TypeError("Failed to fetch"), { onRetry: vi.fn() });
    expect(screen.getByRole("alert").textContent).not.toContain("Failed to fetch");
    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach the server");
  });
});

describe("toast.apiError specifics", () => {
  it("closes itself when its button is used", () => {
    render(<ToastHost />);
    const onRetry = vi.fn();
    act(() => { toast.apiError(apiErr(502, "provider_unreachable", "Down.", "retry"), { onRetry }); });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Down.")).toBeNull();
  });

  it("stays long enough to be used: past 6s for an action, past the countdown for a rate limit", () => {
    render(<ToastHost />);
    act(() => { toast.apiError(apiErr(502, "provider_unreachable", "Down.", "retry"), { onRetry: vi.fn() }); });
    act(() => { vi.advanceTimersByTime(7000); });
    expect(screen.getByText("Down.")).toBeTruthy();
    act(() => { toast.dismiss(); toast.apiError(apiErr(429, "rate_limited", "Slow.", "retry", null, "20"), { onRetry: vi.fn() }); });
    act(() => { vi.advanceTimersByTime(21000); });
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("can leave out a button the screen is already on (Settings)", () => {
    render(<ToastHost />);
    act(() => { toast.apiError(apiErr(400, "provider_key_rejected", "Rejected.", "settings"), { without: ["settings"] }); });
    expect(screen.getByRole("alert").textContent).toContain("Rejected.");
    expect(screen.queryByRole("link", { name: "Open Settings" })).toBeNull();
  });

  it("a retryable error with nothing to retry shows no button", () => {
    render(<ToastHost />);
    act(() => { toast.apiError(apiErr(502, "provider_unreachable", "Down.", "retry")); });
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(new ApiError(500, { code: "x", message: "m", action: null, details: null })).toBeInstanceOf(Error);
  });
});
