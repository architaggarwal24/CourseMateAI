import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyThemePref, readThemePref, resolveMode, setThemePref, THEME_SCRIPT, toggleMode, watchSystemMode } from "./theme";

let systemDark = true;
const listeners = new Set<() => void>();
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.mode;
  systemDark = true;
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() { return q === "(prefers-color-scheme: dark)" ? systemDark : false; }, media: q,
    addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }));
});
afterEach(() => { vi.unstubAllGlobals(); listeners.clear(); });

describe("theme (System / Light / Dark)", () => {
  it("follows the system by default, and an explicit choice wins", () => {
    expect(readThemePref()).toBe("system");
    expect(resolveMode("system", true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });

  it("applies at once (data-mode on <html>), is remembered, and keeps the other appearance settings", () => {
    localStorage.setItem("cmai_appearance", JSON.stringify({ fontSize: "large" }));
    setThemePref("light");
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(JSON.parse(localStorage.getItem("cmai_appearance")!)).toEqual({ fontSize: "large", theme: "light" });
    expect(readThemePref()).toBe("light");
  });

  it("toggles to the opposite of what is showing", () => {
    applyThemePref();                                   // system dark
    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(toggleMode()).toBe("light");
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(toggleMode()).toBe("dark");
  });

  it("on System, follows the device when it switches; an explicit choice ignores it", () => {
    const stop = watchSystemMode();
    applyThemePref();
    systemDark = false; listeners.forEach((l) => l());
    expect(document.documentElement.dataset.mode).toBe("light");
    setThemePref("dark");
    systemDark = true; listeners.forEach((l) => l());
    systemDark = false; listeners.forEach((l) => l());
    expect(document.documentElement.dataset.mode).toBe("dark");
    stop();
    expect(listeners.size).toBe(0);
  });

  it("a stored value it doesn't know falls back to System", () => {
    localStorage.setItem("cmai_appearance", JSON.stringify({ theme: "sepia" }));
    expect(readThemePref()).toBe("system");
    localStorage.setItem("cmai_appearance", "{not json");
    expect(readThemePref()).toBe("system");
  });

  it("the pre-paint script sets the same mode before React runs", () => {
    localStorage.setItem("cmai_appearance", JSON.stringify({ theme: "light", reduceAnimations: true }));
    new Function(THEME_SCRIPT)();
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(document.documentElement.classList.contains("reduce-animations")).toBe(true);
    localStorage.setItem("cmai_appearance", "{}");
    new Function(THEME_SCRIPT)();
    expect(document.documentElement.dataset.mode).toBe("dark");
    document.documentElement.classList.remove("reduce-animations");
  });
});
