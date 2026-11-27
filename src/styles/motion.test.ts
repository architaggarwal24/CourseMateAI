// @vitest-environment node
// The motion system (redesign Stage 3). One vocabulary, in two places that mirror each other:
//   CSS   --motion-press / fast / base / slow / stage and --ease-* (styles/tokens.css), plus the shared keyframes and
//         the .reveal / .stage utilities (components/ui/ui.css)
//   JS    MOTION, SPRING, EASE_OUT_EXPO and the presets in components/fx/motion.ts, for motion/react
// These rules keep a screen from inventing its own timings, so reduced motion and Hero's stepped look reach it too.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "dev") files(p, ext, out); }
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(SRC, p).replace(/\\/g, "/");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Hero keeps its own timings until its chrome is redone (Stage 8): the arena, the play screens, the champion, the
// Bestiary book, the two-worlds chrome and the shared ceremonies (level up, achievements, coin rain).
const HERO = /^(components\/(arena|play|champion|bestiary)\/|components\/shell\/worlds\.css$|components\/fx\/)/;
// The global reduced-motion rules set 0.01ms on purpose; the public site is Stage 9.
const LATER = /^(app\/globals\.css$|components\/landing\/|app\/login\/)/;

describe("motion: one vocabulary", () => {
  const CSS = files(SRC, /\.css$/).map((p) => ({ file: rel(p), text: strip(readFileSync(p, "utf8")) }))
    .filter((f) => !f.file.endsWith("styles/tokens.css") && !HERO.test(f.file) && !LATER.test(f.file));

  it.each(CSS.map((f) => [f.file, f.text]))("%s times its transitions and one-shot animations with the motion tokens", (_f, text) => {
    // loading indicators keep turning (slower) under reduced motion: they carry information, so they are loops too
    const rules = [...(text as string).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => !/spinner|loading-dot/.test(sel));
    const raw = rules.flatMap(([, , body]) => [...body.matchAll(/(?:transition|animation)(?:-duration)?\s*:\s*([^;}]+)/g)])
      .map(([, v]) => v.trim())
      .filter((v) => !/\binfinite\b/.test(v))                       // ambient loops (a pulsing orb) keep their own pace
      .filter((v) => !/^ui-skeleton-show 1ms/.test(v))              // a delay before a skeleton shows, not motion
      .filter((v) => !/^none\b|^inherit\b/.test(v))
      .filter((v) => /\b\d*\.?\d+m?s\b/.test(v.replace(/var\([^)]*\)/g, "")));
    expect(raw).toEqual([]);
  });

  it("nothing enters out of a blur (blur is costly on phones and isn't Ink); the arena's fog is a game rule, not motion", () => {
    const all = files(SRC, /\.(css|tsx)$/).map((p) => ({ file: rel(p), text: strip(readFileSync(p, "utf8")) }));
    const offenders = all.filter((f) => /blur\(\d/.test(f.text.replace(/\.arena-question__text\[data-fogged\][^}]*\}/g, "")))
      .map((f) => f.file);
    expect(offenders).toEqual([]);
  });

  it("Study screens take their motion/react timings from the presets, not from numbers of their own", () => {
    const offenders = files(SRC, /\.tsx$/).map((p) => ({ file: rel(p), text: readFileSync(p, "utf8") }))
      .filter((f) => !HERO.test(f.file))
      .flatMap((f) => [...f.text.matchAll(/transition=\{\{([^}]*)\}\}/g)]
        .filter(([, body]) => /(?:duration|delay|stiffness|damping)\s*:\s*[\d.]/.test(body))
        .map(([m]) => `${f.file}: ${m.slice(0, 80)}`));
    expect(offenders).toEqual([]);
  });

  it("the JS presets match the CSS tokens", async () => {
    const { MOTION } = await import("@/components/fx/motion");
    const tokens = readFileSync(join(SRC, "styles/tokens.css"), "utf8");
    for (const k of ["press", "fast", "base", "slow", "stage"] as const) {
      const ms = Number(tokens.match(new RegExp(`--motion-${k}:\\s*(\\d+)ms`))![1]);
      expect(MOTION[k] * 1000, k).toBeCloseTo(ms, 5);
    }
  });

  it("staging stops after eight items, so a long list never makes the last row wait", async () => {
    const { stagger } = await import("@/components/fx/motion");
    expect(stagger(0).delay).toBe(0);
    expect(stagger(3).delay).toBeCloseTo(0.12, 5);
    expect(stagger(7).delay).toBeCloseTo(stagger(30).delay, 5);
    const ui = strip(readFileSync(join(SRC, "components/ui/ui.css"), "utf8"));
    expect(ui).toMatch(/\.stage > :nth-child\(n \+ 8\)\s*\{\s*--i:\s*7;/);
  });
});

describe("motion: the in-app Reduce animations switch reaches the tokens too", () => {
  it("html.reduce-animations zeroes every motion token, like the OS setting", () => {
    const tokens = strip(readFileSync(join(SRC, "styles/tokens.css"), "utf8"));
    const block = tokens.match(/html\.reduce-animations,\s*html\.reduce-animations \[data-theme\]\s*\{([^}]*)\}/)?.[1] ?? "";
    for (const m of ["press", "fast", "base", "slow", "stage"]) expect(block, m).toMatch(new RegExp(`--motion-${m}:\\s*0`));
  });
});
