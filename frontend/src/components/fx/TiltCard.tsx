"use client";

import { useRef, type HTMLAttributes } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import { reducedMotion } from "./motion";

export interface TiltCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"> {
  /** Max tilt in degrees. */
  max?: number;
  /** Adds a glare that follows the pointer. */
  glare?: boolean;
}

/** A card that tilts in 3D towards the pointer (with an optional glare). Flat for touch and reduced motion. */
export default function TiltCard({ max = 8, glare = true, className, children, style, ...rest }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 220, damping: 20 });
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 220, damping: 20 });
  return (
    <motion.div
      ref={ref}
      className={cn("fx-tilt relative", className)}
      style={{ ...style, rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse" || reducedMotion() || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width;
        const ny = (e.clientY - r.top) / r.height;
        px.set(nx); py.set(ny);
        ref.current.style.setProperty("--gx", `${nx * 100}%`);
        ref.current.style.setProperty("--gy", `${ny * 100}%`);
        ref.current.style.setProperty("--hover", "1");
      }}
      onPointerLeave={() => { px.set(0.5); py.set(0.5); ref.current?.style.setProperty("--hover", "0"); }}
      {...rest}
    >
      {children}
      {glare && <span className="fx-tilt__glare" aria-hidden="true" />}
    </motion.div>
  );
}
