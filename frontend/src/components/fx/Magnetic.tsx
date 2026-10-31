"use client";

import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { reducedMotion } from "./motion";

/**
 * Pulls its child a little towards the pointer while hovered, then springs back. `strength` is the share of the
 * pointer's offset from centre that the child follows (0.25 = a quarter). Inline-block so it wraps a button tightly.
 */
export default function Magnetic({ children, strength = 0.25, className }: { children: ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.6 });
  return (
    <motion.span
      ref={ref}
      className={className}
      style={{ display: "inline-block", x: sx, y: sy }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" || reducedMotion() || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => { x.set(0); y.set(0); }}
    >
      {children}
    </motion.span>
  );
}
