import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral" | "accent" | "success" | "warning" | "danger" | "reward"
  | "common" | "rare" | "epic" | "legendary";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** A short label or number (three words at most): the one kit part that uses the label font, i.e. pixel in Play. */
export default function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return <span className={cn("ui-badge", tone !== "neutral" && `ui-badge--${tone}`, className)} {...rest} />;
}
