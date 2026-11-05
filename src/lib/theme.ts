// Light / dark (Settings -> Appearance, and the Ctrl K menu). The choice is System (the device's setting), Light or
// Dark, kept in localStorage "cmai_appearance".theme next to the font size and Reduce animations. It shows as
// data-mode="light|dark" on <html>, which switches the colour tokens (styles/tokens.css). THEME_SCRIPT runs in
// <head> before the first paint, so a reload never flashes the wrong colours.

export type ThemePref = "system" | "light" | "dark";
export type Mode = "light" | "dark";

const KEY = "cmai_appearance";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPrefs(): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}

export function readThemePref(): ThemePref {
  const t = readPrefs().theme;
  return t === "light" || t === "dark" ? t : "system";
}

const systemIsDark = () => {
  try { return window.matchMedia?.(DARK_QUERY)?.matches !== false; } catch { return true; }
};

export const resolveMode = (pref: ThemePref, systemDark: boolean): Mode =>
  pref === "system" ? (systemDark ? "dark" : "light") : pref;

/** Show the saved choice (or `pref`) on <html>. Returns the mode now showing. */
export function applyThemePref(pref: ThemePref = readThemePref()): Mode {
  const mode = resolveMode(pref, systemIsDark());
  document.documentElement.dataset.mode = mode;
  return mode;
}

export function setThemePref(pref: ThemePref): Mode {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readPrefs(), theme: pref })); } catch { /* private mode: still applies */ }
  window.dispatchEvent(new CustomEvent("cmai:theme", { detail: pref }));
  return applyThemePref(pref);
}

/** Switch to the opposite of what is showing (an explicit choice from then on). */
export function toggleMode(): Mode {
  return setThemePref(document.documentElement.dataset.mode === "light" ? "dark" : "light");
}

/** While the choice is System, follow the device when it switches. Returns a cleanup. */
export function watchSystemMode(): () => void {
  const mql = window.matchMedia?.(DARK_QUERY);
  const onChange = () => { if (readThemePref() === "system") applyThemePref("system"); };
  mql?.addEventListener("change", onChange);
  return () => mql?.removeEventListener("change", onChange);
}

/** Runs in <head> before the first paint: mode, text size and Reduce animations. Dark when anything goes wrong. */
export const THEME_SCRIPT = `(function(){var h=document.documentElement;try{var p=JSON.parse(localStorage.getItem('${KEY}')||'{}');var t=p.theme==='light'||p.theme==='dark'?p.theme:(window.matchMedia&&window.matchMedia('${DARK_QUERY}').matches===false?'light':'dark');h.dataset.mode=t;if(p.fontSize==='large')h.classList.add('text-lg-mode');if(p.reduceAnimations)h.classList.add('reduce-animations');}catch(e){h.dataset.mode='dark';try{localStorage.removeItem('${KEY}');}catch(e2){}}})();`;
