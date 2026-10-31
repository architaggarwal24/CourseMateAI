"use client";

import { motion, useReducedMotionConfig } from "motion/react";
import type { ElementType } from "react";
import { EASE_OUT_EXPO } from "./motion";

/**
 * Text that arrives word by word, each word rising out of a soft blur. The full sentence is the accessible name
 * (aria-label); the animated words are hidden from assistive tech.
 */
export default function TextReveal({ text, as: Tag = "span", className, delay = 0, stagger = 0.045 }: {
  text: string;
  as?: ElementType;
  className?: string;
  delay?: number;
  stagger?: number;
}) {
  const reduce = useReducedMotionConfig();
  const words = text.split(/(\s+)/);
  return (
    <Tag className={className} aria-label={text}>
      {words.map((w, i) => /^\s+$/.test(w) ? w : (
        <motion.span
          key={i}
          aria-hidden="true"
          style={{ display: "inline-block", willChange: "transform, filter, opacity" }}
          initial={reduce ? false : { opacity: 0, y: "0.45em", filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.7, ease: EASE_OUT_EXPO, delay: delay + i * stagger }}
        >
          {w}
        </motion.span>
      ))}
    </Tag>
  );
}
