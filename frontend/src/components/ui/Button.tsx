"use client";

import { forwardRef, type ButtonHTMLAttributes, type PointerEvent } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ripple, sparkBurst } from "@/components/fx/motion";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "link" | "reward";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  /** Shows a spinner, disables the button and sets aria-busy. The label stays so the width does not jump. */
  loading?: boolean;
  /** For a square button that holds only an icon (give it an aria-label). */
  icon?: boolean;
  /** Full-width block button. */
  block?: boolean;
  /** Toggle buttons (a choice in a group): sets aria-pressed. */
  pressed?: boolean;
  /** A burst of sparks from the click point (celebratory actions: claim, buy, summon). Defaults on for "reward". */
  sparks?: boolean;
}

/**
 * The kit's button. Reactive by default: it lifts on hover, a sheen sweeps across solid variants, it squashes on
 * press (spring), and a ripple spreads from the exact point pressed. All of it is CSS/DOM only (no re-render) and
 * all of it switches off under reduced motion.
 * type defaults to "button" so a Button inside a form never submits it by accident.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon = false, block = false, pressed, sparks, className, type = "button",
    disabled, children, onPointerDown, onClick, ...rest },
  ref,
) {
  const solid = variant === "primary" || variant === "danger" || variant === "reward" || variant === "secondary";
  const burst = sparks ?? variant === "reward";
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      className={cn(
        "ui-btn", `ui-btn--${variant}`, solid && "fx-sheen",
        size === "sm" && "ui-btn--sm", size === "lg" && "ui-btn--lg", icon && "ui-btn--icon", block && "ui-btn--block",
        className,
      )}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        if (variant !== "link" && e.button === 0) ripple(e.currentTarget, e.clientX, e.clientY);
        onPointerDown?.(e);
      }}
      onClick={(e) => {
        if (burst && e.detail > 0) sparkBurst(e.clientX, e.clientY);
        onClick?.(e);
      }}
      {...rest}
    >
      {loading && <Loader2 size={size === "sm" ? 14 : 16} className="ui-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});

export default Button;
