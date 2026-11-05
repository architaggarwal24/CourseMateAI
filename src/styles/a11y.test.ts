import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" ? [] : sources(full);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

// The browser-level checks (axe, 360px, keyboard, reduced motion) live in e2e/; these keep the source rules that
// make them pass from being undone by an edit nobody runs Playwright for.
describe("accessibility rules in the source", () => {
  it("a skip link is the first thing in the page, and every page has a #main-content target", () => {
    const layout = read("app/layout.tsx");
    expect(layout.indexOf('href="#main-content"')).toBeGreaterThan(-1);
    expect(layout.indexOf('href="#main-content"')).toBeLessThan(layout.indexOf("<Providers>"));
    for (const file of ["components/shell/AppShell.tsx", "app/login/page.tsx"]) {
      expect(read(file), file).toMatch(/<main id="main-content" tabIndex=\{-1\}/);
    }
    expect(read("app/globals.css")).toMatch(/\.skip-link:focus\s*\{\s*top:/);
  });

  it("nothing removes the focus ring: outline:none is only for elements focused by script (tabIndex -1)", () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      read(relative(SRC, file)).split("\n").forEach((line, i) => {
        if (/outline-none|outline:\s*["']?none|outline:\s*0\b/.test(line) && !/tabIndex=\{-1\}|focus:ring|^\s*\/\//.test(line) && !/outline:\s+"none",\s*$/.test(line)) {
          offenders.push(`${relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 90)}`);
        }
      });
    }
    // (allowed: Tailwind's focus:outline-none paired with a focus:ring, and the forge's <main> style key)
    expect(offenders).toEqual([]);
  });

  it("controls are at least 44px on phones and touch screens", () => {
    const css = read("components/ui/ui.css");
    const block = css.slice(css.indexOf("/* ── Touch targets"));
    expect(block).toMatch(/@media \(pointer: coarse\), \(max-width: 767px\)/);
    for (const rule of [".ui-btn:not(.ui-btn--link)", ".ui-control", ".ui-tab", ".ui-check"]) {
      expect(block, rule).toContain(rule);
    }
    expect(block.match(/min-height: 2\.75rem/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("prefers-reduced-motion switches animation off in the app and in the arena", () => {
    const globals = read("app/globals.css");
    expect(globals).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important/);
    expect(globals).toMatch(/transition-duration: 0\.01ms !important/);
    const arena = read("components/arena/arena.css");
    expect(arena).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
    expect(arena).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
  });

  it("the in-app Appearance settings (large text, reduce animations) have their CSS, and motion/react follows them too", () => {
    const globals = read("app/globals.css");
    expect(globals).toMatch(/html\.text-lg-mode\s*\{[^}]*font-size: 17px/);
    expect(globals).toMatch(/html\.reduce-animations \*[\s\S]*animation-duration: 0\.01ms !important/);
    expect(globals).toMatch(/@keyframes loading-bounce/);
    expect(read("components/Providers.tsx")).toMatch(/reduce-animations/);
  });

  it("the Hero header's XP bar animates with the motion tokens, which reduced motion collapses", () => {
    expect(read("components/hero/hero.css")).toMatch(/transition: width var\(--motion-slow\)/);
    expect(read("styles/tokens.css")).toMatch(/prefers-reduced-motion: reduce[\s\S]*--motion-slow: 0\.01ms/);
  });
});
