import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMediaQuery } from "./useMediaQuery";

afterEach(() => vi.unstubAllGlobals());

function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return matches; }, media: query,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
  return { set: (m: boolean) => { matches = m; listeners.forEach((l) => l()); }, listeners };
}

describe("useMediaQuery", () => {
  it("follows the query as it starts and changes, and stops listening on unmount", () => {
    const mq = fakeMatchMedia(true);
    const { result, unmount } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(true);
    act(() => mq.set(false));
    expect(result.current).toBe(false);
    unmount();
    expect(mq.listeners.size).toBe(0);
  });

  it("is false where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useMediaQuery("(max-width: 767px)"));
    expect(result.current).toBe(false);
  });
});
