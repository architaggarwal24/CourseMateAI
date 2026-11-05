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
// --font-onest / --font-bricolage / --font-geist-mono / --font-pixel are defined at runtime by next/font
const FONTS = { "--font-onest": "Onest", "--font-bricolage": "Bricolage Grotesque", "--font-geist-mono": "Geist Mono", "--font-pixel": "pixel-face" };
const studyOwn = declarations(/:root,\s*\[data-theme="study"\]/);
const study = resolve(studyOwn, FONTS);
const light = resolve(declarations(/:root\[data-mode="light"\],/), { ...FONTS, ...studyOwn });
const play = resolve(declarations(/\[data-theme="play"\]/), study);
const THEMES = { study, light, play } as const;

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

describe("the Study theme (Ink)", () => {
  it("has one accent: the legacy purple and gold highlights resolve to the same blue, in both modes", () => {
    for (const t of [study, light]) for (const n of ["accent-alt", "highlight"]) {
      expect(t[`--color-${n}`]).toBe(t["--color-accent"]);
      expect(t[`--color-${n}-text`]).toBe(t["--color-accent-text"]);
    }
  });
  it("is ink: a pure black page in dark, white in light, and a deep ink-blue accent", () => {
    expect(study["--color-surface"]).toBe("#000000");
    expect(light["--color-surface"]).toBe("#ffffff");
    expect(study["--color-accent"]).toBe("#3550c8");
    expect(light["--color-accent"]).toBe("#1f3aa8");
  });
  it("sets Onest for text, Bricolage Grotesque for display, Geist Mono for code; no pixel font; 72ch reading width", () => {
    expect(study["--font-sans"]).toMatch(/^Onest,/);
    expect(study["--font-display"]).toMatch(/^Bricolage Grotesque,/);
    expect(study["--font-mono"]).toMatch(/^Geist Mono,/);
    expect(study["--font-label"]).not.toMatch(/pixel/);
    expect(study["--measure"]).toBe("72ch");
  });
  it("uses soft corners", () => {
    expect(study["--radius-md"]).toBe("10px");
  });
});

describe("flat: no gradients, glass or glow", () => {
  const tokens = [...code.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  it("the only gradient token left is the arena's star dots", () => {
    expect([...new Set(tokens.filter((t) => t.startsWith("--gradient-")))]).toEqual(["--gradient-arena-stars"]);
    expect(study["--gradient-arena-stars"]).toBe("none");
  });
  it.each(Object.entries(THEMES))("%s: panels are opaque, nothing blurs, glows are transparent", (_n, t) => {
    expect(t["--glass-bg"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t["--glass-border"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t["--glass-blur"]).toBe("0px");
    for (const k of ["--glow-accent", "--aurora-a", "--spotlight", "--sheen"]) expect(t[k], k).toBe("transparent");
  });
});

describe("the Hero theme (darker Ink)", () => {
  it("stays dark in light mode, keeps the ink-blue accent, and uses gold only as the highlight/reward", () => {
    expect(code).toMatch(/\[data-theme="play"\] \{\s*color-scheme: dark;/);
    expect(play["--color-surface"]).toBe("#000000");
    expect(play["--color-accent"]).toBe(study["--color-accent"]);
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
