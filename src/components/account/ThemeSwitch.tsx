"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Monitor, Moon, Sun } from "@/components/icons";
import { readThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/**
 * Settings -> Appearance: System / Light / Dark. A radio group (one tab stop, arrow keys move the choice) that
 * applies the pick at once, no Save button. It also follows a change made from the Ctrl K menu.
 */
export default function ThemeSwitch() {
  const [pref, setPref] = useState<ThemePref>("system");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setPref(readThemePref());
    const onChange = () => setPref(readThemePref());
    window.addEventListener("cmai:theme", onChange);
    return () => window.removeEventListener("cmai:theme", onChange);
  }, []);

  const choose = (value: ThemePref) => { setPref(value); setThemePref(value); };
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + OPTIONS.length) % OPTIONS.length;
    choose(OPTIONS[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Theme" className="theme-switch">
      {OPTIONS.map(({ value, label, icon: Icon }, i) => (
        <button key={value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={pref === value}
          tabIndex={pref === value ? 0 : -1} onClick={() => choose(value)} onKeyDown={(e) => onKey(e, i)}
          className={cn("theme-switch__opt", pref === value && "theme-switch__opt--on")}>
          <Icon size={15} aria-hidden="true" />{label}
        </button>
      ))}
    </div>
  );
}
