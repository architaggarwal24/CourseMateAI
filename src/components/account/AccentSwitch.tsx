"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ACCENTS, readAccent, setAccent, type Accent } from "@/lib/theme";
import { cn } from "@/lib/utils";

const LABEL: Record<Accent, string> = { ink: "Ink", teal: "Teal", plum: "Plum", forest: "Forest", ember: "Ember" };

/**
 * Settings -> Appearance: Study's accent colour (the two worlds, Stage 6). A radio group like the theme switch:
 * applied at once, kept in this browser. Every accent keeps its text readable in light and dark. The Hero world
 * keeps its own colours.
 */
export default function AccentSwitch() {
  const [accent, set] = useState<Accent>("ink");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    set(readAccent());
    const on = () => set(readAccent());
    window.addEventListener("cmai:accent", on);
    return () => window.removeEventListener("cmai:accent", on);
  }, []);
  const choose = (a: Accent) => { set(a); setAccent(a); };
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + ACCENTS.length) % ACCENTS.length;
    choose(ACCENTS[next]);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Accent colour" className="theme-switch accent-switch">
      {ACCENTS.map((a, i) => (
        <button key={a} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={accent === a}
          tabIndex={accent === a ? 0 : -1} onClick={() => choose(a)} onKeyDown={(e) => onKey(e, i)}
          className={cn("theme-switch__opt", accent === a && "theme-switch__opt--on")} data-accent-swatch={a}>
          <span className="accent-switch__dot" aria-hidden="true" />{LABEL[a]}
        </button>
      ))}
    </div>
  );
}
