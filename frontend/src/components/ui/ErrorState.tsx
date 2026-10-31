"use client";

import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { describeError, withoutActions, type ErrorActionKind, type ErrorInfo } from "@/lib/errorActions";
import { ROUTES } from "@/lib/routes";
import { useCountdown } from "@/hooks/useCountdown";
import Button from "./Button";
import ButtonLink from "./ButtonLink";
import Card from "./Card";

export interface ErrorActionsProps {
  info: ErrorInfo;
  /** What "Retry" does. Without it a retryable error shows no button (there is nothing to re-run). */
  onRetry?: () => void;
  /** What "Re-upload" does. Without it the button goes to the Study page, where the document is uploaded. */
  onReupload?: () => void;
  /** Called after any of the buttons was used (a toast closes itself). */
  onDone?: () => void;
  size?: "sm" | "md";
}

/** The one button an error offers: Open Settings / usage link / Retry (after the countdown) / Re-upload / Log in. */
export function ErrorActions({ info, onRetry, onReupload, onDone, size = "sm" }: ErrorActionsProps) {
  const left = useCountdown(info.retryAfter);
  const { action } = info;
  if (!action) return null;

  switch (action.kind) {
    case "settings":
    case "login":
      return <ButtonLink href={action.href!} size={size} onClick={onDone}>{action.label}</ButtonLink>;
    case "usage":
      return (
        <ButtonLink href={action.href!} size={size} target="_blank" rel="noopener noreferrer" onClick={onDone}>
          {action.label}
        </ButtonLink>
      );
    case "reupload":
      return onReupload
        ? <Button size={size} onClick={() => { onDone?.(); onReupload(); }}>{action.label}</Button>
        : <ButtonLink href={ROUTES.study} size={size} onClick={onDone}>{action.label}</ButtonLink>;
    case "retry": {
      const waiting = info.retryAfter !== null && left > 0;
      if (!onRetry) {
        return waiting ? <span className="ui-error__wait">Try again in {left}s</span> : null;
      }
      return (
        <Button size={size} disabled={waiting} onClick={() => { onDone?.(); onRetry(); }}>
          {waiting ? `Retry in ${left}s` : action.label}
        </Button>
      );
    }
  }
}

export interface ErrorStateProps {
  /** Whatever was caught. ApiError -> its message and the button for its code; anything else -> "couldn't reach the server" + Retry. */
  error: unknown;
  onRetry?: () => void;
  onReupload?: () => void;
  /** Shown instead of the default text when the error isn't an ApiError. */
  fallbackMessage?: string;
  /** Buttons not to offer (a screen that is already where the button leads). */
  without?: ErrorActionKind[];
  className?: string;
}

/** The inline error: a calm card with the message and the right button. The toast twin is `toast.apiError()`. */
export default function ErrorState({ error, onRetry, onReupload, fallbackMessage, without, className }: ErrorStateProps) {
  const info = withoutActions(describeError(error, fallbackMessage), without);
  return (
    <Card tone="danger" pad="sm" role="alert" data-error-code={info.code} className={cn("ui-error", className)}>
      <div className="ui-error__row">
        <AlertCircle size={18} className="ui-error__icon" aria-hidden="true" />
        <p className="ui-error__message">{info.message}</p>
        <div className="ui-error__actions">
          <ErrorActions info={info} onRetry={onRetry} onReupload={onReupload} />
        </div>
      </div>
    </Card>
  );
}
