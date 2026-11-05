import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source rules behind the small UX details (the browser checks live in e2e/). Each one guards a detail that is easy
// to undo by an edit nobody looks at on a phone or with reduced motion on.
const SRC = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const block = (css: string, selector: string) => {
  const i = css.indexOf(`${selector} {`);
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i) + 1);
};

describe("UX details", () => {
  it("skeletons hold their space but only show after 300 ms, with or without motion", () => {
    const ui = read("components/ui/ui.css");
    expect(block(ui, ".ui-skeleton")).toMatch(/opacity:\s*0/);
    expect(block(ui, ".ui-skeleton")).toMatch(/ui-skeleton-show\s+1ms\s+linear\s+300ms\s+forwards/);
    const reduced = ui.slice(ui.indexOf("@media (prefers-reduced-motion: reduce) { .ui-skeleton"));
    expect(reduced.slice(0, 160)).toMatch(/ui-skeleton-show\s+1ms\s+linear\s+300ms\s+forwards/);
    // the global reduced-motion rules zero every delay: the skeleton keeps its 300 ms
    const globals = read("app/globals.css");
    expect(globals).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.ui-skeleton \{ animation-delay: 300ms !important; \}/);
    expect(globals).toMatch(/html\.reduce-animations \.ui-skeleton \{ animation-delay: 300ms !important; \}/);
  });

  it("page changes finish in under 300 ms, and full-page loads cross-fade only when motion is allowed", () => {
    const template = read("app/(app)/template.tsx");
    const seconds = Number(template.match(/duration:\s*([\d.]+)/)![1]);
    expect(seconds).toBeLessThan(0.3);
    const globals = read("app/globals.css");
    const i = globals.indexOf("@media (prefers-reduced-motion: no-preference) {\n  @view-transition");
    expect(i).toBeGreaterThan(-1);
    const rule = globals.slice(i, globals.indexOf("\n}", i));
    expect(rule).toMatch(/navigation:\s*auto/);
    const ms = [...rule.matchAll(/animation-duration:\s*(\d+)ms/g)].map((m) => Number(m[1]));
    expect(ms.length).toBeGreaterThan(0);
    expect(Math.max(...ms)).toBeLessThan(300);
    expect(globals).toMatch(/html\.reduce-animations::view-transition-group\(\*\)[^{]*\{[^}]*animation:\s*none/);
  });

  it("numbers that change in place keep their width (tabular figures): arena timer, HP, counters, AI spend", () => {
    const arena = read("components/arena/arena.css");
    for (const sel of [".arena-stat", ".arena-timer__num", ".arena-item-count"]) {
      expect(block(arena, sel), sel).toMatch(/font-variant-numeric:\s*tabular-nums/);
    }
    expect(block(read("components/arena/arena-v2.css"), ".arena-mech__counter")).toMatch(/font-variant-numeric:\s*tabular-nums/);
    const admin = read("components/account/AdminPanel.tsx");
    expect(admin).toMatch(/<p className="[^"]*tabular-nums[^"]*">\s*Today:/);
    expect(admin).toMatch(/<li key=\{`\$\{m\.provider\}:\$\{m\.model\}`\} className="[^"]*tabular-nums/);
  });

  it("headings balance their lines and paragraphs avoid a lone last word", () => {
    const globals = read("app/globals.css");
    const base = globals.slice(globals.indexOf("@layer base {"));
    expect(block(base, "h1, h2, h3, h4")).toMatch(/text-wrap:\s*balance/);
    expect(base).toMatch(/\n  p, li, figcaption, blockquote \{\s*text-wrap:\s*pretty;/);
  });

  it("buttons, fields, cards, dialogs and toasts get squircle corners where the browser has corner-shape", () => {
    const ui = read("components/ui/ui.css");
    const i = ui.indexOf("@supports (corner-shape: squircle) {");
    expect(i).toBeGreaterThan(-1);
    const rule = ui.slice(i, ui.indexOf("\n}", i));
    for (const sel of [".ui-btn", ".ui-control", ".ui-card", ".ui-modal", ".ui-toast"]) expect(rule).toContain(sel);
    expect(rule).toMatch(/corner-shape:\s*squircle/);
    // a squircle reads tighter than a round corner of the same radius: the radius grows to keep the softness
    expect(rule).toMatch(/border-radius:\s*calc\(var\(--radius-md\) \* var\(--squircle-k\)\)/);
    // pills and circles stay round (no squircle on radius-full)
    expect(rule).not.toMatch(/--radius-full/);
  });

  it("the page reaches under the notch and home bar (viewport-fit=cover) and every edge keeps clear of them", () => {
    expect(read("app/layout.tsx")).toMatch(/viewportFit:\s*"cover"/);
    const globals = read("app/globals.css");
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(globals).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px);`);
    }
    const shell = read("components/shell/shell.css");
    expect(block(shell, ".app-shell")).toMatch(/padding:\s*var\(--safe-top\) var\(--safe-right\) 0 var\(--safe-left\)/);
    expect(shell).toMatch(/@media \(min-width: 768px\) \{ \.app-shell \{ flex-direction: row; padding-bottom: var\(--safe-bottom\); \} \}/);
    const toasts = block(read("components/ui/ui.css"), ".ui-toasts");
    expect(toasts).toMatch(/top:\s*calc\(var\(--space-4\) \+ var\(--safe-top\)\)/);
    expect(toasts).toMatch(/right:\s*calc\(var\(--space-4\) \+ var\(--safe-right\)\)/);
    expect(block(read("app/login/login.css"), ".login")).toMatch(/padding:\s*var\(--safe-top\) var\(--safe-right\) var\(--safe-bottom\) var\(--safe-left\)/);
    expect(block(read("app/legal/legal.css"), ".legal")).toMatch(/--safe-top/);
    expect(block(globals, ".offline")).toMatch(/--safe-top/);
    expect(read("components/pdf/pdf.css")).toMatch(/\.pdf-panel\[data-side\] \{ position: fixed; inset: 0;[^}]*padding: var\(--safe-top\) var\(--safe-right\) var\(--safe-bottom\) var\(--safe-left\)/);
  });

  it("the phone sheet has no CSS keyframes (its springs can be caught mid-way), a 44px handle, and clears the home bar", () => {
    const ui = read("components/ui/ui.css");
    const sheet = block(ui, ".ui-modal.ui-modal--sheet");
    expect(sheet).toMatch(/animation:\s*none/);
    expect(sheet).toMatch(/var\(--safe-bottom\)/);
    expect(block(ui, ".ui-modal__handle")).toMatch(/min-height:\s*44px/);
    expect(block(ui, ".ui-modal__handle")).toMatch(/touch-action:\s*none/);
  });

  it("tabs never shrink below their label (a 44px minimum on touch must not let them overlap)", () => {
    expect(block(read("components/ui/ui.css"), ".ui-tab")).toMatch(/flex:\s*none/);
  });

  it("labels are never faded with opacity (it drops their contrast below AA on coloured buttons)", () => {
    for (const [file, sel] of [["components/review/review.css", ".review-grade__when"], ["components/review/review.css", ".review-grade__key"],
      ["components/arena/arena.css", ".arena-wait__secs"]] as const) {
      expect(block(read(file), sel), sel).not.toMatch(/opacity/);
    }
  });
});
