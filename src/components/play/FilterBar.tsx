"use client";

import type { ReactNode } from "react";
import { Lock } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export interface FilterOption<T extends string> { id: T; label: string; count?: number | string; icon?: ReactNode; locked?: boolean }

/**
 * One row of filters in the Hero world: a framed strip of options, the chosen one lit, each with its count. Used in
 * place of loose pill buttons (Achievements, the Forge). A group of toggle buttons: one is always pressed.
 */
export default function FilterBar<T extends string>({ label, value, options, onChange, className, size }: {
  label: string; value: T; options: FilterOption<T>[]; onChange: (id: T) => void; className?: string; size?: "lg";
}) {
  return (
    <div className={cn("px-filter", size === "lg" && "px-filter--lg", className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" className="px-filter__opt" aria-pressed={value === o.id} data-locked={o.locked || undefined} onClick={() => onChange(o.id)}>
          {o.icon}
          <span>{o.label}</span>
          {o.locked && <Lock size={10} aria-label="locked" />}
          {o.count !== undefined && <span className="px-filter__count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
