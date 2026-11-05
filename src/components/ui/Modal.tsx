"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import ThemeScope, { type Theme } from "@/components/ThemeScope";
import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  /** Buttons for the footer, right-aligned (usually <Button>s). */
  actions?: ReactNode;
  size?: "md" | "wide";
  /** "alertdialog" for a question that needs an answer (confirm/discard). */
  role?: "dialog" | "alertdialog";
  /** Clicking the dim backdrop closes the modal. Default true. */
  closeOnBackdrop?: boolean;
  /** What gets focus when it opens. Default: the first focusable control inside. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

const TABBABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex], [contenteditable="true"]';

export function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(el => {
    if ((el as HTMLButtonElement).disabled) return false;
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) < 0) return false;
    return !el.closest("[hidden], [inert]");
  });
}

// Open modals, oldest first. Only the top-most one reacts to Escape and Tab, so stacked modals unwind one by one.
const stack: symbol[] = [];

/**
 * An accessible dialog in a portal: focus moves in when it opens, Tab / Shift+Tab wrap inside it, Escape (and a
 * click on the backdrop) closes it, focus returns to whatever opened it, and the page behind does not scroll.
 * The portal leaves the page's theme scope, so the modal re-enters the scope its caller is in (Study or Play).
 */
export default function Modal({
  open, onClose, title, children, actions, size = "md", role = "dialog", closeOnBackdrop = true, initialFocusRef, className,
}: ModalProps) {
  const titleId = useId();
  const marker = useRef<HTMLSpanElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialRef = useRef(initialFocusRef);
  initialRef.current = initialFocusRef;
  const downOnBackdrop = useRef(false);

  // Which theme scope is the caller in? (The portal itself is outside every scope.)
  useLayoutEffect(() => {
    if (!open) { setTheme(null); return; }
    const scope = marker.current?.closest<HTMLElement>("[data-theme]")?.dataset.theme;
    setTheme(scope === "play" ? "play" : "study");
  }, [open]);

  const shown = open && theme !== null;
  useEffect(() => {
    if (!shown) return;
    const me = Symbol("modal");
    stack.push(me);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const node = dialog.current!;
    const first = initialRef.current?.current ?? tabbables(node)[0] ?? node;
    first.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = tabbables(node);
      if (items.length === 0) { e.preventDefault(); node.focus(); return; }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && node.contains(active) && active !== node;
      if (e.shiftKey) {
        if (!inside || active === firstItem) { e.preventDefault(); lastItem.focus(); }
      } else if (!inside || active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      stack.splice(stack.indexOf(me), 1);
      document.body.style.overflow = previousOverflow;
      if (opener && opener.isConnected) opener.focus();
    };
  }, [shown]);

  return (
    <>
      <span ref={marker} hidden />
      {shown && createPortal(
        <ThemeScope theme={theme}>
          <div
            className="ui-modal-overlay"
            onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
            onClick={e => {
              if (closeOnBackdrop && downOnBackdrop.current && e.target === e.currentTarget) onClose();
              downOnBackdrop.current = false;
            }}
          >
            <div
              ref={dialog}
              role={role}
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              className={cn("ui-modal", size === "wide" && "ui-modal--wide", className)}
            >
              <h2 id={titleId} className="ui-modal__title">{title}</h2>
              {children !== undefined && <div className="ui-modal__body">{children}</div>}
              {actions && <div className="ui-modal__actions">{actions}</div>}
            </div>
          </div>
        </ThemeScope>,
        document.body,
      )}
    </>
  );
}
