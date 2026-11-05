"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  /** The panel shown while this tab is selected. */
  content?: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled selection. Without it the component keeps its own (starting at defaultValue or the first enabled tab). */
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  className?: string;
}

/**
 * WAI-ARIA tabs with automatic activation: ArrowRight/ArrowLeft move to the next/previous enabled tab (wrapping),
 * Home/End jump to the first/last, and focusing a tab selects it. Only the selected tab is in the Tab order
 * (roving tabindex), so Tab moves from the list into the panel.
 */
export default function Tabs({ tabs, value, defaultValue, onChange, label, className }: TabsProps) {
  const base = useId();
  const firstEnabled = tabs.find(t => !t.disabled)?.id ?? tabs[0]?.id;
  const [inner, setInner] = useState(defaultValue ?? firstEnabled);
  const selected = value ?? inner;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.filter(t => !t.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex(t => t.id === selected);
    let next: number;
    switch (e.key) {
      case "ArrowRight": next = (current + 1) % enabled.length; break;
      case "ArrowLeft": next = (current - 1 + enabled.length) % enabled.length; break;
      case "Home": next = 0; break;
      case "End": next = enabled.length - 1; break;
      default: return;
    }
    e.preventDefault();
    const target = enabled[next];
    select(target.id);
    refs.current.get(target.id)?.focus();
  };

  const active = tabs.find(t => t.id === selected);
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;

  return (
    <div className={cn("ui-tabs", className)}>
      <div role="tablist" aria-label={label} className="ui-tabs__list" onKeyDown={onKeyDown}>
        {tabs.map(t => {
          const isSelected = t.id === selected;
          return (
            <button
              key={t.id}
              ref={el => { if (el) refs.current.set(t.id, el); else refs.current.delete(t.id); }}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={isSelected}
              aria-controls={isSelected && t.content !== undefined ? panelId(t.id) : undefined}
              tabIndex={isSelected ? 0 : -1}
              disabled={t.disabled}
              className="ui-tab"
              onClick={() => select(t.id)}
            >
              {t.label}
              {isSelected && <motion.span layoutId={`${base}-bar`} className="ui-tab__bar" transition={{ type: "spring", stiffness: 520, damping: 40 }} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {active?.content !== undefined && (
        <div role="tabpanel" id={panelId(active.id)} aria-labelledby={tabId(active.id)} tabIndex={0} className="ui-tabs__panel">
          {active.content}
        </div>
      )}
    </div>
  );
}
