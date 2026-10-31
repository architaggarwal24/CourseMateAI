"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { describedBy, FieldFrame, useFieldIds, type FieldProps } from "./field";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldProps {
  mono?: boolean;
  onInset?: boolean;
  wrapperClassName?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, mono, onInset, className, wrapperClassName, id: idProp, "aria-describedby": extra, ...rest },
  ref,
) {
  const ids = useFieldIds(idProp);
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} className={wrapperClassName}>
      <textarea
        ref={ref}
        id={ids.id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error, extra)}
        className={cn("ui-control", mono && "ui-control--mono", onInset && "ui-control--on-inset", className)}
        {...rest}
      />
    </FieldFrame>
  );
});

export default Textarea;
