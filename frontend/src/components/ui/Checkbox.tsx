"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: ReactNode;
  description?: ReactNode;
  /** Renders as an on/off switch (role="switch") instead of a box. Same keyboard behaviour: Space toggles. */
  appearance?: "box" | "switch";
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, appearance = "box", className, id: idProp, "aria-describedby": extra, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? auto;
  const descId = `${id}-desc`;
  const isSwitch = appearance === "switch";
  const input = (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      role={isSwitch ? "switch" : undefined}
      aria-describedby={[extra, description ? descId : null].filter(Boolean).join(" ") || undefined}
      className={cn("ui-check__input", isSwitch && "ui-check__input--switch")}
      {...rest}
    />
  );
  const text = (
    <span>
      <span className="ui-check__text">{label}</span>
      {description && <span id={descId} className="ui-check__desc">{description}</span>}
    </span>
  );
  return (
    <label htmlFor={id} className={cn("ui-check", isSwitch && "ui-check--switch", className)}>
      {isSwitch ? <>{text}{input}</> : <>{input}{text}</>}
    </label>
  );
});

export default Checkbox;
