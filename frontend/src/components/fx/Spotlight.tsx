"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { usePointerVars } from "./usePointerVars";
import { mergeRefs } from "./mergeRefs";

export interface SpotlightProps extends HTMLAttributes<HTMLDivElement> {
  /** Diameter of the soft light inside (px). */
  size?: number;
}

/** A surface lit from where the pointer is: a soft fill plus a bright edge near the cursor. Wrap any card. */
const Spotlight = forwardRef<HTMLDivElement, SpotlightProps>(function Spotlight({ size, className, style, ...rest }, ref) {
  const pointer = usePointerVars<HTMLDivElement>();
  return (
    <div
      ref={mergeRefs(ref, pointer)}
      className={cn("fx-spotlight", className)}
      style={size ? { ...style, ["--spot-size" as string]: `${size}px` } : style}
      {...rest}
    />
  );
});

export default Spotlight;
