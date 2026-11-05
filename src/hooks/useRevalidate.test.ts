import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRevalidate } from "./useRevalidate";

afterEach(() => vi.useRealTimers());

const setVisibility = (v: DocumentVisibilityState) =>
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });

describe("useRevalidate", () => {
  it("runs again when the window gets focus, the tab is shown again, or the network comes back", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    renderHook(() => useRevalidate(fn));
    expect(fn).not.toHaveBeenCalled();                                   // not on mount: the caller loads first

    window.dispatchEvent(new Event("focus"));
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2000);
    window.dispatchEvent(new Event("online"));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("asks once when focus and visibility fire together, and not while the tab is hidden", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    renderHook(() => useRevalidate(fn));
    setVisibility("visible");
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2000);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does nothing when disabled, and stops listening on unmount", () => {
    const fn = vi.fn();
    const { rerender, unmount } = renderHook(({ on }) => useRevalidate(fn, on), { initialProps: { on: false } });
    window.dispatchEvent(new Event("online"));
    expect(fn).not.toHaveBeenCalled();
    rerender({ on: true });
    window.dispatchEvent(new Event("online"));
    expect(fn).toHaveBeenCalledTimes(1);
    unmount();
    window.dispatchEvent(new Event("focus"));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
