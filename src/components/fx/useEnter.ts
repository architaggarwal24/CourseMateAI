"use client";

import { useReducedMotionConfig } from "motion/react";
import { stagger } from "./motion";

type Preset = {
  initial: Record<string, number>;
  animate: Record<string, number>;
  transition: Record<string, unknown>;
};

/**
 * Entrance props for a motion element from a preset (REVEAL, ARRIVE, POP in ./motion), staged when given an index.
 * With reduced motion (the OS setting or the in-app switch) the element is simply there: no fade either.
 * (MotionConfig's reducedMotion only stops transforms; a fade of half a second still keeps the page moving.)
 *
 *   const enter = useEnter();
 *   <motion.li {...enter(REVEAL, i)} />
 */
export function useEnter() {
  const reduce = useReducedMotionConfig();
  return (preset: Preset, index?: number, after = 0) => ({
    initial: reduce ? (false as const) : preset.initial,
    animate: preset.animate,
    transition: index === undefined && after === 0 ? preset.transition : { ...preset.transition, ...stagger(index ?? 0, after) },
  });
}
