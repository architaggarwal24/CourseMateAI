"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { describedBy, FieldFrame, useFieldIds, type FieldProps } from "./field";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size">, FieldProps {
  mono?: boolean;
  /** The field sits on an inset (darker) panel, so it takes the lighter elevated background. */
  onInset?: boolean;
  /** A tone for the destructive confirm field. */
  danger?: boolean;
  /** Decoration inside the left edge (an icon). Not interactive. */
  leading?: ReactNode;
  /** Inside the right edge: a show/hide Button, a spinner, a status icon. */
  trailing?: ReactNode;
  wrapperClassName?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, mono, onInset, danger, leading, trailing, className, wrapperClassName, id: idProp, "aria-describedby": extra, ...rest },
  ref,
) {
  const ids = useFieldIds(idProp);
  const control = (
    <input
      ref={ref}
      id={ids.id}
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy(ids, hint, error, extra)}
      className={cn(
        "ui-control", mono && "ui-control--mono", onInset && "ui-control--on-inset", danger && "ui-control--danger",
        leading && "ui-control--lead", trailing && "ui-control--trail", className,
      )}
      {...rest}
    />
  );
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} className={wrapperClassName}>
      {leading || trailing ? (
        <span className="ui-input-wrap">
          {leading && <span className="ui-input-wrap__lead" aria-hidden="true">{leading}</span>}
          {control}
          {trailing && <span className="ui-input-wrap__trail">{trailing}</span>}
        </span>
      ) : control}
    </FieldFrame>
  );
});

export default Input;
