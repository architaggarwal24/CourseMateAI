import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  circle?: boolean;
}

/** A placeholder block while content loads. Decorative: hidden from screen readers (label the region instead). */
export default function Skeleton({ width = "100%", height = "1rem", circle, className, style, ...rest }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("ui-skeleton", circle && "ui-skeleton--circle", className)}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
}
