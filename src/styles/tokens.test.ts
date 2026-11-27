// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const css = readFileSync(here("./tokens.css"), "utf8");
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");               // without comments

// ── read the two themes out of tokens.css ────────────────────────────────────
function declarations(selectorStart: RegExp): Record<string, string> {
  const block = code.match(new RegExp(selectorStart.source + String.raw`[^{]*\{([\s\S]*?)\n\}`, "m"));
  if (!block) throw new Error(`no block for ${selectorStart}`);
  const out: Record<string, string> = {};
  for (const m of block[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function resolve(own: Record<string, string>, base: Record<string, string>): Record<string, string> {
  const get = (name: string, depth = 0): string => {
    const raw = own[name] ?? base[name];
    if (raw === undefined) throw new Error(`${name} is not defined`);
    if (depth > 10) throw new Error(`${name}: reference loop`);
    return raw.replace(/var\((--[a-z0-9-]+)\)/g, (_, n) => get(n, depth + 1));
  };
  return Object.fromEntries([...Object.keys({ ...base, ...own })].map((k) => [k, get(k)]));
}
// --font-onest / --font-fraunces / --font-wordmark / --font-geist-mono / --font-pixel are defined at runtime by next/font
const FONTS = { "--font-onest": "Onest", "--font-fraunces": "Fraunces", "--font-wordmark": "Bricolage wordmark", "--font-geist-mono": "Geist Mono", "--font-pixel": "pixel-face", "--font-pixel-body": "pixel-body-face" };
// the primitives (--prim-*): raw values the themes point at
const PRIMITIVES = declarations(/^:root(?=\s*\{)/);
const BASE = { ...FONTS, ...PRIMITIVES };
const studyOwn = declarations(/:root,\s*\[data-theme="study"\]/);
const study = resolve(studyOwn, BASE);
const light = resolve(declarations(/:root\[data-mode="light"\],/), { ...BASE, ...studyOwn });
const play = resolve(declarations(/\[data-theme="play"\]/), study);
const THEMES = { study, light, play } as const;

// components read only the semantic layer
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
function primitiveUses(): string[] {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(css|tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "tokens.css" && /var\(--prim-/.test(readFileSync(p, "utf8"))) out.push(relative(root, p));
    }
  };
  walk(root);
  return out;
}

// ── WCAG contrast ────────────────────────────────────────────────────────────
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const tint = (fg: string, bg: string, a: number) =>
  "#" + rgb(fg).map((v, i) => Math.round(v * a + rgb(bg)[i] * (1 - a)).toString(16).padStart(2, "0")).join("");

const SURFACES = ["surface", "surface-sunken", "elevated", "elevated-hover", "raised", "raised-hover"];
const TEXT_ON_SURFACE = [
  "text", "text-secondary", "muted",
  "accent-text", "accent-alt-text", "highlight-text", "success-text", "warning-text", "danger-text", "reward",
  "rarity-common", "rarity-rare", "rarity-epic", "rarity-legendary",
];
const FILL_PAIRS = [
  ["accent", "on-accent"], ["accent-alt", "on-accent-alt"], ["highlight", "on-highlight"],
  ["success", "on-success"], ["warning", "on-warning"], ["danger", "on-danger"], ["reward", "on-reward"],
];

describe.each(Object.entries(THEMES))("%s theme meets WCAG AA", (_name, t) => {
  const c = (n: string) => t[`--color-${n}`];

  it("has a hex value for every colour token", () => {
    for (const [k, v] of Object.entries(t)) if (k.startsWith("--color-") && !k.includes("scroll")) expect(v, k).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(TEXT_ON_SURFACE)("%s text is at least 4.5:1 on every surface", (token) => {
    for (const s of SURFACES) expect(ratio(c(token), c(s)), `${token} on ${s}`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(FILL_PAIRS)("text on a %s fill (%s) is at least 4.5:1", (fill, on) => {
    expect(ratio(c(fill), c(on)), `${on} on ${fill}`).toBeGreaterThanOrEqual(4.5);
  });

  it("accent text and muted text stay readable on a tinted accent background (bg-accent-*/20 over a card)", () => {
    const bg = tint(c("accent"), c("elevated"), 0.2);
    expect(ratio(c("accent-text"), bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c("muted"), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("the focus ring is at least 3:1 against the surfaces", () => {
    const ring = t["--focus-ring-color"];
    for (const s of SURFACES) expect(ratio(ring, c(s)), `focus ring on ${s}`).toBeGreaterThanOrEqual(3);
  });
});

describe("the Study theme (Ink)", () => {
  it("has one accent: the legacy purple and gold highlights resolve to the same blue, in both modes", () => {
    for (const t of [study, light]) for (const n of ["accent-alt", "highlight"]) {
      expect(t[`--color-${n}`]).toBe(t["--color-accent"]);
      expect(t[`--color-${n}-text`]).toBe(t["--color-accent-text"]);
    }
  });
  it("is ink: a deep ink page in dark, warm paper in light, and a deep ink-blue accent", () => {
    expect(study["--color-surface"]).toBe("#0b0d12");
    expect(light["--color-surface"]).toBe("#fbfaf7");
    expect(study["--color-accent"]).toBe("#3550c8");
    expect(light["--color-accent"]).toBe("#1f3aa8");
  });
  it("sets Onest for text, Fraunces for display, the Bricolage cut for the wordmark, Geist Mono for code; no pixel font; 72ch reading width", () => {
    expect(study["--font-sans"]).toMatch(/^Onest,/);
    expect(study["--font-display"]).toMatch(/^Fraunces,.*serif$/);
    expect(study["--font-brand"]).toMatch(/^Bricolage wordmark,/);
    expect(study["--font-mono"]).toMatch(/^Geist Mono,/);
    expect(study["--font-label"]).not.toMatch(/pixel/);
    expect(study["--measure"]).toBe("72ch");
  });
  it("uses soft corners", () => {
    expect(study["--radius-md"]).toBe("10px");
  });
  // Stage 1: depth comes from four surface levels, each a step lighter in dark mode
  const lightness = (hex: string) => lum(hex);
  it("dark mode steps up: page < rail < card < raised", () => {
    const steps = ["surface", "surface-sunken", "elevated", "raised"].map((n) => lightness(study[`--color-${n}`]));
    for (let i = 1; i < steps.length; i++) expect(steps[i], `level ${i}`).toBeGreaterThan(steps[i - 1]);
  });
  it("light mode: cards and raised surfaces are lighter than the paper page and the rail", () => {
    expect(lightness(light["--color-elevated"])).toBeGreaterThan(lightness(light["--color-surface"]));
    expect(lightness(light["--color-surface"])).toBeGreaterThan(lightness(light["--color-surface-sunken"]));
    expect(light["--color-raised"]).toBe(light["--color-elevated"]);
  });
  it("components never read a primitive: --prim-* appears only in tokens.css", () => {
    expect(primitiveUses()).toEqual([]);
  });
  it("names the motion vocabulary, and reduced motion zeroes all of it", () => {
    expect(study["--motion-press"]).toBe("90ms");
    expect(study["--motion-stage"]).toBe("40ms");
    const reduced = code.match(/prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    for (const m of ["press", "fast", "base", "slow", "stage"]) expect(reduced, m).toMatch(new RegExp(`--motion-${m}:\\s*0`));
  });
});

describe("flat: no gradients, glass or glow (one light layer allowed)", () => {
  const tokens = [...code.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2]] as const);
  it("the only gradient tokens are the arena's star dots and the light layer", () => {
    expect([...new Set(tokens.filter(([t]) => t.startsWith("--gradient-")).map(([t]) => t))]).toEqual(["--gradient-arena-stars"]);
    expect(study["--gradient-arena-stars"]).toBe("none");
    const painted = [...new Set(tokens.filter(([, v]) => /gradient\(/.test(v)).map(([t]) => t))].sort();
    expect(painted).toEqual(["--gradient-arena-stars", "--light-soft"]);
  });
  it("the light layer is one soft radial wash of the accent into transparent, fainter in light mode, absent in Hero", () => {
    expect(studyOwn["--light-soft"]).toMatch(/^radial-gradient\([^,]+, var\(--light-color\), transparent \d+%\)$/);
    expect(studyOwn["--light-color"]).toMatch(/^color-mix\(in srgb, var\(--color-accent\) (\d+)%, transparent\)$/);
    const pct = (v: string) => Number(v.match(/(\d+)%/)![1]);
    expect(pct(studyOwn["--light-color"])).toBeLessThanOrEqual(20);
    expect(pct(light["--light-color"])).toBeLessThan(pct(studyOwn["--light-color"]));
    expect(play["--light-soft"]).toBe("none");
    for (const media of ["prefers-reduced-transparency: reduce", "print"]) {
      expect(code, media).toMatch(new RegExp(`@media \\(?${media.replace(/[()]/g, "\\$&")}\\)?\\s*\\{[^}]*--light-soft:\\s*none`));
    }
  });
  it.each(Object.entries(THEMES))("%s: panels are opaque, nothing blurs, glows are transparent", (_n, t) => {
    expect(t["--glass-bg"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t["--glass-border"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t["--glass-blur"]).toBe("0px");
    for (const k of ["--glow-accent", "--aurora-a", "--spotlight", "--sheen"]) expect(t[k], k).toBe("transparent");
  });
});

describe("the Hero theme (darker Ink)", () => {
  // Stage P3: the Hero area is its own 16-bit look (indigo night panels, square corners, stepped motion, pixel fonts)
  it("stays dark in light mode, has its own night palette and pixel type, and uses gold only as the highlight/reward", () => {
    expect(code).toMatch(/\[data-theme="play"\] \{\s*color-scheme: dark;/);
    expect(play["--color-surface"]).toBe("#0a0b1e");
    expect(play["--color-surface"]).not.toBe(study["--color-surface"]);
    expect(play["--radius-md"]).toBe("0px");
    expect(play["--font-sans"]).toMatch(/pixel-body/);
    expect(play["--color-highlight"]).toBe(play["--color-reward"]);
    expect(play["--color-highlight"]).not.toBe(play["--color-accent"]);
    expect(play["--font-label"]).toMatch(/pixel/);
  });
  it("defines every token the Study theme does", () => {
    expect(Object.keys(play).sort()).toEqual(Object.keys(study).sort());
  });
});

describe("tailwind colours", () => {
  const globals = readFileSync(here("../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const theme = globals.match(/@theme inline\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const colors = [...theme.matchAll(/(--color-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()] as const);

  it("every Tailwind colour is a var() pointing at a token that exists", () => {
    expect(colors.length).toBeGreaterThan(15);
    for (const [name, value] of colors) {
      const token = value.match(/^var\((--[a-z0-9-]+)\)$/)?.[1];
      expect(token, `${name}: ${value}`).toBeTruthy();
      expect(study[token!], token).toBeDefined();
    }
  });
  it("no Tailwind colour shares a token's name (a theme variable must never shadow a token)", () => {
    for (const [name] of colors) expect(Object.keys(study), name).not.toContain(name);
  });
  it("fills (accent-*) and inks (ink-*) cover the same five colours", () => {
    const of = (prefix: string) => colors.filter(([n]) => n.startsWith(prefix)).map(([n]) => n.slice(prefix.length)).sort();
    expect(of("--color-accent-")).toEqual(["blue", "gold", "green", "purple", "red"]);
    expect(of("--color-ink-")).toEqual(of("--color-accent-"));
  });
});
