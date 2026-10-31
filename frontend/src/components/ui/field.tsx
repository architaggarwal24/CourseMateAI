"use client";

import { useId, type ReactNode } from "react";

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
}

/** Label + control + hint/error wiring shared by Input, Select and Textarea. Internal to the kit. */
export function useFieldIds(explicitId?: string) {
  const auto = useId();
  const id = explicitId ?? auto;
  return { id, hintId: `${id}-hint`, errorId: `${id}-error` };
}

export function describedBy(ids: { hintId: string; errorId: string }, hint: ReactNode, error: ReactNode, extra?: string) {
  return [extra, error ? ids.errorId : null, hint ? ids.hintId : null].filter(Boolean).join(" ") || undefined;
}

export function FieldFrame({
  id, hintId, errorId, label, hint, error, className, children,
}: FieldProps & { id: string; hintId: string; errorId: string; className?: string; children: ReactNode }) {
  return (
    <div className={`ui-field ${className ?? ""}`.trim()}>
      {label && <label htmlFor={id} className="ui-field__label">{label}</label>}
      {children}
      {error && <p id={errorId} role="alert" className="ui-field__error">{error}</p>}
      {hint && <p id={hintId} className="ui-field__hint">{hint}</p>}
    </div>
  );
}
