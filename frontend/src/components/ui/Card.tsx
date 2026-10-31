"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePointerVars } from "@/components/fx/usePointerVars";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** A header band with this title. Without it the card is just a surface. */
  title?: ReactNode;
  /** Heading level for the title. Defaults to h2. */
  headingLevel?: 2 | 3 | 4;
  tone?: "default" | "danger" | "warning" | "success";
  /** "inset" sits one step darker (a panel inside a card). */
  surface?: "elevated" | "inset";
  raised?: boolean;
  /** Padding of the content. With a title the body gets the default padding. */
  pad?: "none" | "sm" | "lg";
  /** Lit by the pointer: a soft spotlight inside and a bright edge near the cursor. */
  interactive?: boolean;
}

/** A frosted-glass surface (see .ui-card in ui.css). */
export default function Card({
  title, headingLevel = 2, tone = "default", surface = "elevated", raised, pad, interactive, className, children, ...rest
}: CardProps) {
  const pointer = usePointerVars<HTMLDivElement>();
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <div
      ref={interactive ? pointer : undefined}
      className={cn(
        "ui-card", surface === "inset" && "ui-card--inset", raised && "ui-card--raised", interactive && "fx-spotlight",
        tone !== "default" && `ui-card--${tone}`,
        !title && pad === "sm" && "ui-card--pad", !title && pad === "lg" && "ui-card--pad-lg",
        className,
      )}
      {...rest}
    >
      {title ? (
        <>
          <div className="ui-card__header"><Heading className="ui-card__title">{title}</Heading></div>
          <div className="ui-card__body ui-card__body--stack">{children}</div>
        </>
      ) : children}
    </div>
  );
}
