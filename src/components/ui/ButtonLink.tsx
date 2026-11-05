import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import type { ButtonVariant } from "./Button";

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  block?: boolean;
}

/** A link that looks like a Button: for moving to another page (a Button is for doing something on this one). */
export default function ButtonLink({ variant = "secondary", size = "md", block, className, ...rest }: ButtonLinkProps) {
  return (
    <Link
      className={cn("ui-btn", `ui-btn--${variant}`, size === "sm" && "ui-btn--sm", block && "ui-btn--block", className)}
      style={{ textDecoration: variant === "link" ? undefined : "none" }}
      {...rest}
    />
  );
}
