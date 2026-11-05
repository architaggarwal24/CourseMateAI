"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import ThemeScope, { type Theme } from "@/components/ThemeScope";
import { describeError, withoutActions, type ErrorActionKind } from "@/lib/errorActions";
import Button from "./Button";
import { ErrorActions } from "./ErrorState";

export type ToastKind = "success" | "error" | "info";

export interface ToastOptions {
  /** Replaces the default status icon (an emoji, usually). */
  icon?: ReactNode;
  /** A second, quieter line. */
  description?: ReactNode;
  /** Milliseconds before it goes away. Default 4000 (errors 6000). 0 keeps it until dismissed. */
  duration?: number;
  /** A button under the message (see toast.apiError). */
  action?: ReactNode;
}

export interface ApiErrorToastOptions {
  /** What "Retry" does. Without it a retryable error shows no button. */
  onRetry?: () => void;
  /** What "Re-upload" does. Without it the button goes to the Study page. */
  onReupload?: () => void;
  /** Shown instead of the default text when the error isn't an ApiError (never the raw browser message). */
  fallbackMessage?: string;
  /** Buttons not to offer (a screen that is already where the button leads). */
  without?: ErrorActionKind[];
}

interface ToastItem extends ToastOptions {
  id: number;
  kind: ToastKind;
  message: ReactNode;
  theme: Theme;
}

const MAX_VISIBLE = 5;
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => items;
const EMPTY: ToastItem[] = [];

// A toast takes the theme of the screen that raised it: a Play screen is on the page while it fires -> Play look.
function currentTheme(): Theme {
  return typeof document !== "undefined" && document.querySelector('[data-theme="play"]') ? "play" : "study";
}

function push(kind: ToastKind, message: ReactNode, options: ToastOptions = {}): number {
  const id = nextId++;
  items = [...items, { ...options, id, kind, message, theme: currentTheme() }].slice(-MAX_VISIBLE);
  emit();
  return id;
}

function dismiss(id?: number) {
  items = id === undefined ? [] : items.filter(t => t.id !== id);
  emit();
}

/**
 * The toast for a failed request: the server's message plus the button its error code calls for
 * (Open Settings / usage link / Retry / Re-upload / Log in / Retry after the Retry-After countdown).
 * The inline twin is <ErrorState>; both read lib/errorActions.ts.
 */
function apiError(err: unknown, options: ApiErrorToastOptions = {}): number {
  const info = withoutActions(describeError(err, options.fallbackMessage), options.without);
  const needsTime = info.retryAfter !== null ? (info.retryAfter + 4) * 1000 : 0;
  // A plain Retry with nothing to re-run (and no countdown to show) has no button.
  const hasButton = !!info.action && !(info.action.kind === "retry" && !options.onRetry && info.retryAfter === null);
  const id: number = push("error", info.message, {
    // An actionable error stays long enough to be used (a rate limit: until its countdown has finished).
    duration: hasButton ? Math.max(10000, needsTime) : undefined,
    action: hasButton ? (
      <ErrorActions info={info} onRetry={options.onRetry} onReupload={options.onReupload} onDone={() => dismiss(id)} />
    ) : undefined,
  });
  return id;
}

/** Raise a notification: toast.success("Saved"), toast.error(...), toast.info(...). Needs <ToastHost /> on the page. */
export const toast = {
  success: (message: ReactNode, options?: ToastOptions) => push("success", message, options),
  error: (message: ReactNode, options?: ToastOptions) => push("error", message, options),
  info: (message: ReactNode, options?: ToastOptions) => push("info", message, options),
  apiError,
  dismiss,
};

const ICONS: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={16} style={{ color: "var(--color-success-text)" }} />,
  error: <AlertCircle size={16} style={{ color: "var(--color-danger-text)" }} />,
  info: <Info size={16} style={{ color: "var(--color-accent-text)" }} />,
};

function ToastView({ item }: { item: ToastItem }) {
  const [paused, setPaused] = useState(false);
  const duration = item.duration ?? (item.kind === "error" ? 6000 : 4000);

  useEffect(() => {
    if (paused || duration <= 0) return;
    const t = setTimeout(() => dismiss(item.id), duration);
    return () => clearTimeout(t);
  }, [paused, duration, item.id]);

  return (
    <ThemeScope theme={item.theme}>
      <div
        role={item.kind === "error" ? "alert" : "status"}
        className={`ui-toast ui-toast--${item.kind}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <span className="ui-toast__icon" aria-hidden="true">{item.icon ?? ICONS[item.kind]}</span>
        <div className="ui-toast__main">
          <div>{item.message}</div>
          {item.description && <div className="ui-toast__desc">{item.description}</div>}
          {item.action && <div className="ui-toast__action">{item.action}</div>}
        </div>
        {duration > 0 && (
          <span
            className="ui-toast__timer" aria-hidden="true"
            style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? "paused" : "running" }}
          />
        )}
        <Button variant="ghost" size="sm" icon className="ui-toast__close" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}>
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
    </ThemeScope>
  );
}

/** Mount once, near the root. Renders the toasts raised with `toast.*`. */
export function ToastHost() {
  const list = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  return (
    // Always mounted, so a screen reader is already listening when a toast arrives: errors are role="alert"
    // (assertive), everything else role="status" (polite). Closed toasts are removed from the page, not hidden.
    <section aria-label="Notifications" aria-live="polite" aria-relevant="additions text" className="ui-toasts">
      {list.map(item => <ToastView key={item.id} item={item} />)}
    </section>
  );
}
