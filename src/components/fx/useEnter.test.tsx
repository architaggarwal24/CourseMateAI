import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useEnter } from "./useEnter";
import { MOTION, REVEAL } from "./motion";

const withMotion = (reducedMotion: "always" | "never") => ({ children }: { children: ReactNode }) =>
  <MotionConfig reducedMotion={reducedMotion}>{children}</MotionConfig>;

describe("useEnter", () => {
  it("gives the preset's entrance, staged by index and capped at the eighth item", () => {
    const { result } = renderHook(() => useEnter(), { wrapper: withMotion("never") });
    expect(result.current(REVEAL).initial).toEqual(REVEAL.initial);
    expect(result.current(REVEAL).transition).toBe(REVEAL.transition);
    expect(result.current(REVEAL, 2).transition).toMatchObject({ duration: MOTION.base, delay: 2 * MOTION.stage });
    expect((result.current(REVEAL, 40).transition as { delay: number }).delay).toBeCloseTo(7 * MOTION.stage, 5);
    expect((result.current(REVEAL, 1, 0.1).transition as { delay: number }).delay).toBeCloseTo(0.1 + MOTION.stage, 5);
  });

  it("with reduced motion the element is simply there: no fade, no rise", () => {
    const { result } = renderHook(() => useEnter(), { wrapper: withMotion("always") });
    expect(result.current(REVEAL, 3).initial).toBe(false);
    expect(result.current(REVEAL).animate).toEqual(REVEAL.animate);
  });
});
