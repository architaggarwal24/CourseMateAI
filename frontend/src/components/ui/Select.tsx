"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { describedBy, FieldFrame, useFieldIds, type FieldProps } from "./field";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">, FieldProps {
  onInset?: boolean;
  wrapperClassName?: string;
}

/** A native <select> (so the keyboard and screen-reader behaviour is the browser's), styled from the tokens. */
const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, onInset, className, wrapperClassName, id: idProp, "aria-describedby": extra, children, ...rest },
  ref,
) {
  const ids = useFieldIds(idProp);
  return (
    <FieldFrame {...ids} label={label} hint={hint} error={error} className={wrapperClassName}>
      <span className="ui-select">
        <select
          ref={ref}
          id={ids.id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ids, hint, error, extra)}
          className={cn("ui-control", onInset && "ui-control--on-inset", className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown size={16} className="ui-select__chevron" aria-hidden="true" />
      </span>
    </FieldFrame>
  );
});

export default Select;
