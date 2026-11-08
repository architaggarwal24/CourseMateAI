import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  circle?: boolean;
}

/** True when the classes set this dimension (h-[360px], w-full ...): then the inline default must not override them. */
const sizedBy = (className: string | undefined, prefix: "h-" | "w-") =>
  !!className && className.split(/\s+/).some((c) => c.startsWith(prefix));

/**
 * A placeholder block while content loads. Decorative: hidden from screen readers (label the region instead).
 * Size it with the width / height props or with Tailwind classes; a class wins over the defaults (an inline style
 * would otherwise beat it and leave a 1rem sliver, so the page jumps when the content arrives).
 */
export default function Skeleton({ width, height, circle, className, style, ...rest }: SkeletonProps) {
  const w = width ?? (sizedBy(className, "w-") ? undefined : "100%");
  const h = height ?? (sizedBy(className, "h-") ? undefined : "1rem");
  return (
    <span
      aria-hidden="true"
      className={cn("ui-skeleton", circle && "ui-skeleton--circle", className)}
      style={{ ...(w !== undefined && { width: w }), ...(h !== undefined && { height: h }), ...style }}
      {...rest}
    />
  );
}
