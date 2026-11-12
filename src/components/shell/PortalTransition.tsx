"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotionConfig } from "motion/react";
import { usePortal } from "@/hooks/usePortal";
import type { World } from "@/lib/worlds";

/** The crossing's timing (ms): the screen breaks into blocks, the page changes, the blocks fall away. */
export const COVER_MS = 340, REVEAL_MS = 380, FADE_MS = 140;
const COLS = 16, ROWS = 10;
/** If the new world hasn't come up by then (a slow page), the blocks fall away anyway. */
const STUCK_MS = 4000;

/** The colours of the world on screen now: its surfaces, and a few pixels of its accent. */
function palette(): string[] {
  const shell = document.querySelector(".app-shell");
  if (!shell) return ["#111827", "#1f2937", "#374151", "#6366f1"];
  const css = getComputedStyle(shell);
  const v = (name: string, d: string) => css.getPropertyValue(name).trim() || d;
  const hero = shell.getAttribute("data-world") === "hero";
  return [v("--color-surface", "#111827"), v("--color-surface-sunken", "#0b0e26"), v("--color-elevated", "#1f2937"), hero ? "#a78bfa" : v("--color-accent", "#6366f1")];
}

/** Focus where you are in the new world's menu (or its screen), so the keyboard starts there. */
function focusNewWorld() {
  const visible = (el: Element | null): el is HTMLElement => !!el && (el as HTMLElement).offsetParent !== null;
  const menus = [...document.querySelectorAll('nav[aria-label="Main"]')].filter(visible);
  const target = menus.map((m) => m.querySelector('a[aria-current="page"]') ?? m.querySelector("a")).find(visible)
    ?? document.getElementById("main-content");
  (target as HTMLElement | null)?.focus({ preventScroll: true });
}

/**
 * The portal between the worlds (Stage 2): the screen breaks into pixel blocks in the colours of the world you're
 * leaving, the page changes behind them, and they fall away in the colours of the world you've entered. A screen
 * reader hears where you are; the keyboard lands in the new world's menu. Reduced motion: a quick fade.
 */
export default function PortalTransition({ world }: { world: World }) {
  const phase = usePortal((s) => s.phase);
  const to = usePortal((s) => s.to);
  const href = usePortal((s) => s.href);
  const seq = usePortal((s) => s.seq);
  const router = useRouter();
  const reduce = !!useReducedMotionConfig();
  const [colors, setColors] = useState<string[]>([]);
  const [announce, setAnnounce] = useState("");
  const cells = useMemo(() => Array.from({ length: COLS * ROWS }, () => ({ d: Math.random(), shade: Math.random() })), [seq]);

  // cover: the blocks in the world you're leaving; once they cover the screen, the page changes behind them
  useEffect(() => {
    if (phase !== "cover" || !href) return;
    setColors(palette());
    setAnnounce("");
    const go = setTimeout(() => router.push(href), reduce ? FADE_MS : COVER_MS);
    const stuck = setTimeout(() => usePortal.getState().revealed(), STUCK_MS);
    return () => { clearTimeout(go); clearTimeout(stuck); };
  }, [phase, seq]); // eslint-disable-line react-hooks/exhaustive-deps

  // the new world is up: its colours, then the blocks fall away
  useEffect(() => {
    if (phase !== "cover" || to !== world) return;
    const f = requestAnimationFrame(() => { setColors(palette()); usePortal.getState().revealed(); });
    return () => cancelAnimationFrame(f);
  }, [phase, to, world]);

  useEffect(() => {
    if (phase !== "reveal") return;
    setAnnounce(to === "hero" ? "Entered the Hero world" : "Back in Study");
    const t = setTimeout(() => { usePortal.getState().done(); focusNewWorld(); }, reduce ? FADE_MS : REVEAL_MS);
    return () => clearTimeout(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const dur = phase === "cover" ? COVER_MS : REVEAL_MS;
  return (
    <>
      {phase !== "idle" && (
        <div className="portal-fx" data-phase={phase} data-to={to ?? undefined} data-testid="portal-fx" aria-hidden="true"
          style={{ "--cols": COLS, "--rows": ROWS } as React.CSSProperties}>
          {reduce
            ? <span className="portal-fx__fade" style={{ background: colors[0] }} />
            : cells.map((c, i) => (
              <span key={i} className="portal-fx__cell" style={{
                background: c.shade > 0.92 ? colors[3] : colors[Math.floor(c.shade * 3.26) % 3],
                animationDelay: `${Math.round(c.d * (dur - 120))}ms`,
              }} />
            ))}
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </>
  );
}
