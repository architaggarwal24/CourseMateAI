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
// --font-geist-* / --font-pixel are defined at runtime by next/font
const study = resolve(declarations(/:root,\s*\[data-theme="study"\]/), { "--font-geist-sans": "Geist", "--font-geist-mono": "Geist Mono", "--font-pixel": "pixel-face" });
const play = resolve(declarations(/\[data-theme="play"\]/), study);
const THEMES = { study, play } as const;

// ── WCAG contrast ────────────────────────────────────────────────────────────
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const tint = (fg: string, bg: string, a: number) =>
  "#" + rgb(fg).map((v, i) => Math.round(v * a + rgb(bg)[i] * (1 - a)).toString(16).padStart(2, "0")).join("");

const SURFACES = ["surface", "surface-sunken", "elevated", "elevated-hover"];
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

describe("the Study theme", () => {
  it("has one accent: the legacy purple and gold highlights resolve to the same blue", () => {
    for (const n of ["accent-alt", "highlight"]) {
      expect(study[`--color-${n}`]).toBe(study["--color-accent"]);
      expect(study[`--color-${n}-text`]).toBe(study["--color-accent-text"]);
    }
  });
  it("uses soft charcoal surfaces, not pure black", () => {
    for (const s of SURFACES) expect(study[`--color-${s}`]).not.toMatch(/^#0+$/);
    expect(lum(study["--color-surface"])).toBeGreaterThan(0.005);
  });
  it("labels use Inter (no pixel font) and reading text is capped at 72ch", () => {
    expect(study["--font-label"]).not.toMatch(/pixel/);
    expect(study["--measure"]).toBe("72ch");
    expect(study["--line-height-body"]).toBe("1.6");
  });
  it("keeps the arena scenery out of Study: the sky, floor and stars are Play-only", () => {
    expect(study["--gradient-arena-sky"]).toBe("none");
    expect(study["--gradient-arena-floor"]).toBe("none");
    expect(study["--gradient-arena-stars"]).toBe("none");
  });
  it("glass is translucent paint, never a colour token (contrast is checked on the opaque --color-* values)", () => {
    for (const k of ["--glass-bg", "--glass-bg-strong", "--glass-border"]) expect(study[k], k).toMatch(/^rgba\(/);
  });
});

describe("the Play theme", () => {
  it("has gold and purple accents and the pixel label font", () => {
    expect(play["--color-highlight"]).not.toBe(play["--color-accent"]);
    expect(play["--color-accent-alt"]).not.toBe(play["--color-accent"]);
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
