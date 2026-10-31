"use client";

import { cloneElement, useCallback, useEffect, useId, useState, type ReactElement, type ReactNode } from "react";

export interface TooltipProps {
  content: ReactNode;
  /** The one element that triggers it (a Button, an icon button ...). It must be focusable. */
  children: ReactElement<{ "aria-describedby"?: string }>;
  placement?: "top" | "bottom";
}

/** Shows on hover and on keyboard focus, hides on leave, blur and Escape. Described-by link for screen readers. */
export default function Tooltip({ content, children, placement = "top" }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const existing = children.props["aria-describedby"];
  return (
    <span className="ui-tooltip-anchor" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {cloneElement(children, { "aria-describedby": open ? [existing, id].filter(Boolean).join(" ") : existing })}
      {open && (
        <span id={id} role="tooltip" className={`ui-tooltip${placement === "bottom" ? " ui-tooltip--below" : ""}`}>
          {content}
        </span>
      )}
    </span>
  );
}
