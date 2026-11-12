"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useDragControls, useMotionValue, type PanInfo } from "motion/react";
import ThemeScope, { type Theme } from "@/components/ui/ThemeScope";
import { reducedMotion, SPRING } from "@/components/fx/motion";
import { useMediaQuery } from "@/hooks/useMediaQuery";
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

/** Phones get a bottom sheet (the same breakpoint as the bottom navigation). */
export const SHEET_QUERY = "(max-width: 767px)";

/**
 * Let go of a dragged sheet: does it close? Dragged down past a third of its height (at most 140px), or flicked down
 * fast after a real move. Up is never a close.
 */
export function sheetShouldClose(offsetY: number, velocityY: number, height: number): boolean {
  if (offsetY <= 0) return false;
  return offsetY > Math.min(140, height / 3) || (velocityY > 500 && offsetY > 16);
}

// Open modals, oldest first. Only the top-most one reacts to Escape and Tab, so stacked modals unwind one by one.
const stack: symbol[] = [];

/**
 * An accessible dialog in a portal: focus moves in when it opens, Tab / Shift+Tab wrap inside it, Escape (and a
 * click on the backdrop) closes it, focus returns to whatever opened it, and the page behind does not scroll.
 * The portal leaves the page's theme scope, so the modal re-enters the scope its caller is in (Study or Play).
 *
 * On a phone it is a bottom sheet: it springs up from the bottom, and dragging its handle or title down (or a flick)
 * closes it; a shorter drag springs back. The handle is also a real Close button. The springs can be caught mid-way
 * (a drag interrupts the entrance), and reduced motion makes both instant.
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
  const sheet = useMediaQuery(SHEET_QUERY);
  const sheetY = useMotionValue(0);
  const drag = useDragControls();

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
    const first = initialRef.current?.current ?? tabbables(node).find((el) => !el.dataset.sheetHandle) ?? node;
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

  // Slide the sheet away, then close. (Reduced motion: close at once.) If the caller keeps it open, it comes back.
  const dismissSheet = () => {
    if (reducedMotion()) { onCloseRef.current(); return; }
    const height = dialog.current?.offsetHeight || window.innerHeight;
    void animate(sheetY, height, { ...SPRING.snappy, velocity: sheetY.getVelocity() }).then(() => {
      onCloseRef.current();
      requestAnimationFrame(() => sheetY.jump(0));
    });
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (sheetShouldClose(info.offset.y, info.velocity.y, dialog.current?.offsetHeight ?? 0)) dismissSheet();
  };
  const startDrag = (e: ReactPointerEvent) => { if (sheet) drag.start(e); };

  return (
    <>
      <span ref={marker} hidden />
      {shown && createPortal(
        <ThemeScope theme={theme}>
          <div
            className={cn("ui-modal-overlay", sheet && "ui-modal-overlay--sheet")}
            onMouseDown={e => { downOnBackdrop.current = e.target === e.currentTarget; }}
            onClick={e => {
              if (closeOnBackdrop && downOnBackdrop.current && e.target === e.currentTarget) onClose();
              downOnBackdrop.current = false;
            }}
          >
            <motion.div
              ref={dialog}
              role={role}
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              className={cn("ui-modal", size === "wide" && "ui-modal--wide", sheet && "ui-modal--sheet", className)}
              {...(sheet && {
                style: { y: sheetY },
                initial: { y: "100%" },
                animate: { y: 0 },
                transition: SPRING.soft,
                drag: "y" as const,
                dragListener: false,
                dragControls: drag,
                dragConstraints: { top: 0, bottom: 0 },
                dragElastic: { top: 0.04, bottom: 1 },
                onDragEnd,
              })}
            >
              {sheet && (
                <button type="button" className="ui-modal__handle" aria-label="Close" data-sheet-handle="true"
                  onPointerDown={startDrag} onClick={dismissSheet}>
                  <span className="ui-modal__grip" aria-hidden="true" />
                </button>
              )}
              <h2 id={titleId} className="ui-modal__title" onPointerDown={startDrag}>{title}</h2>
              {children !== undefined && <div className="ui-modal__body">{children}</div>}
              {actions && <div className="ui-modal__actions">{actions}</div>}
            </motion.div>
          </div>
        </ThemeScope>,
        document.body,
      )}
    </>
  );
}
