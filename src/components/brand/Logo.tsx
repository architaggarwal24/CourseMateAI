import { cn } from "@/lib/utils";

/**
 * The CourseMateAI mark, "Companion C": a C (the course) with a dot in its opening (you, the mate). Drawn on a
 * 32-unit grid with gaps that stay open at 16px. scripts/brand-assets.mjs draws the favicon, app icons and the link
 * preview from these same numbers.
 */
export const MARK = {
  viewBox: "0 0 32 32",
  c: "M22.69 8.57A10 10 0 1 0 22.69 23.43",
  stroke: 5,
  dot: { cx: 25.5, cy: 16, r: 3.3 },
} as const;

export function LogoMark({ size = 28, title, className }: { size?: number; title?: string; className?: string }) {
  return (
    <svg viewBox={MARK.viewBox} width={size} height={size} className={cn("brand-mark", className)}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true, focusable: false })}>
      <path d={MARK.c} fill="none" stroke="currentColor" strokeWidth={MARK.stroke} strokeLinecap="round" />
      <circle cx={MARK.dot.cx} cy={MARK.dot.cy} r={MARK.dot.r} className="brand-mark__dot" />
    </svg>
  );
}

/** The mark and the wordmark: "CourseMate" in ink, "AI" in the accent (the dot's colour). */
export default function Logo({ size = 28, wordmark = true, className }: { size?: number; wordmark?: boolean; className?: string }) {
  return (
    <span role="img" aria-label="CourseMateAI" className={cn("brand", className)} style={{ ["--brand-size" as string]: `${size}px` }}>
      <LogoMark size={size} />
      {wordmark && <span className="brand__word" aria-hidden="true">CourseMate<span className="brand__ai">AI</span></span>}
    </span>
  );
}
