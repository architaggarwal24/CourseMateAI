// Small, dependency-free helpers shared by the effects.

/** True when the visitor asked for less motion (OS setting or the in-app "Reduce animations" switch). */
export function reducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    || document.documentElement.classList.contains("reduce-animations");
}

/**
 * Spring presets (motion/react `transition`). Snappy for controls, soft for panels, bouncy for rewards, indicator for
 * a tab's sliding underline, card for a card that is dealt or swiped, flip for a flashcard turning over.
 */
export const SPRING = {
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 },
  indicator: { type: "spring", stiffness: 520, damping: 40 },
  card: { type: "spring", stiffness: 280, damping: 26 },
  flip: { type: "spring", stiffness: 180, damping: 22 },
  soft: { type: "spring", stiffness: 260, damping: 30 },
  bouncy: { type: "spring", stiffness: 420, damping: 18 },
  pill: { type: "spring", stiffness: 420, damping: 38 },
} as const;

/** Ease used for entrances (fast out, long settle). */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * The motion vocabulary in seconds (redesign Stage 3): the same values as the --motion-* tokens in
 * styles/tokens.css (a test keeps them equal). press: a button or chip under the finger; fast: hover, toggles, a tab
 * indicator; base: menus, popovers, a confirm; slow: dialogs, sheets, a page change; stage: the step between
 * staged list items.
 */
export const MOTION = { press: 0.09, fast: 0.15, base: 0.24, slow: 0.38, stage: 0.04 } as const;

/** At most this many items are staged; the rest arrive with the eighth. */
export const STAGE_MAX = 8;

/** The delay for the i-th item of a staged list (0-based), capped so a long list never makes the last row wait. */
export function stagger(i: number, after = 0) {
  return { delay: after + Math.min(Math.max(0, i), STAGE_MAX - 1) * MOTION.stage };
}

/**
 * motion/react presets. Spread the parts into a motion element:
 *   <motion.li {...REVEAL} transition={{ ...REVEAL.transition, ...stagger(i) }} />
 * MotionConfig (components/shell/Providers.tsx) turns them off for reduced motion and the in-app switch.
 */
export const REVEAL = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: MOTION.base, ease: EASE_OUT_EXPO },
} as const;

/** A panel or a page arriving: a little longer and a little further than a list item. */
export const ARRIVE = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: MOTION.slow, ease: EASE_OUT_EXPO },
} as const;

/** A small thing popping into place from its corner (a bubble, a badge): springy, quick to settle. */
export const POP = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  transition: SPRING.snappy,
} as const;

/**
 * A spark burst at a screen point: `count` small rays flung outwards, removed when their animation ends.
 * Purely decorative; does nothing under reduced motion.
 */
export function sparkBurst(x: number, y: number, opts: { count?: number; distance?: number; color?: string } = {}) {
  if (reducedMotion() || typeof document === "undefined") return;
  const { count = 8, distance = 26, color } = opts;
  for (let i = 0; i < count; i++) {
    const el = document.createElement("span");
    el.className = "fx-spark";
    el.setAttribute("aria-hidden", "true");
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--a", `${(360 / count) * i + Math.random() * 12}deg`);
    el.style.setProperty("--d", `${distance + Math.random() * 10}px`);
    if (color) el.style.setProperty("--spark-color", color);
    el.addEventListener("animationend", () => el.remove(), { once: true });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
}

/** A press ripple inside `host` (which must be position: relative; overflow: hidden) at the pointer position. */
export function ripple(host: HTMLElement, clientX: number, clientY: number) {
  if (reducedMotion()) return;
  const r = host.getBoundingClientRect();
  const el = document.createElement("span");
  el.className = "fx-ripple";
  el.setAttribute("aria-hidden", "true");
  el.style.left = `${clientX - r.left}px`;
  el.style.top = `${clientY - r.top}px`;
  el.style.setProperty("--ripple-scale", String(Math.ceil((Math.hypot(r.width, r.height) * 2) / 12)));
  el.addEventListener("animationend", () => el.remove(), { once: true });
  host.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
