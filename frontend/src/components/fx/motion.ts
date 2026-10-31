// Small, dependency-free helpers shared by the effects.

/** True when the visitor asked for less motion (OS setting or the in-app "Reduce animations" switch). */
export function reducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    || document.documentElement.classList.contains("reduce-animations");
}

/** Spring presets (motion/react `transition`). Snappy for controls, soft for panels, bouncy for rewards. */
export const SPRING = {
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 },
  soft: { type: "spring", stiffness: 260, damping: 30 },
  bouncy: { type: "spring", stiffness: 420, damping: 18 },
  pill: { type: "spring", stiffness: 420, damping: 38 },
} as const;

/** Ease used for entrances (fast out, long settle). */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

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
