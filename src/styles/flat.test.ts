// @vitest-environment node
// Ink is flat: no gradients, no frosted glass, no glow. (The arena's star dots and two CSS techniques that only
// look like gradients in code are the exceptions: a mask that cuts a border ring, and a range slider's hard-edged fill.)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "dev") files(p, out); }
    else if (/\.(css|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "tokens.css") out.push(p);
  }
  return out;
}
const ALL = files(SRC).map((p) => ({ file: relative(SRC, p), text: readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "") }));
const ALLOWED = [
  /linear-gradient\(#000 0 0\)/g,                                                   // mask: cut out a border ring
  /linear-gradient\(90deg, var\(--color-accent-text\) var\(--fill[^)]*\)[^;]*/g,      // range slider: hard-edged fill
];

describe("flat Ink surfaces", () => {
  it.each(ALL.map((f) => [f.file, f.text]))("%s paints no gradients", (_file, text) => {
    let t = text as string;
    for (const re of ALLOWED) t = t.replace(re, "");
    expect(t).not.toMatch(/(?:linear|radial|conic)-gradient\(/);
    expect(t.replace(/var\(--gradient-arena-stars\)/g, "")).not.toMatch(/var\(--gradient-/);
  });
  it.each(ALL.map((f) => [f.file, f.text]))("%s blurs nothing behind it", (_file, text) => {
    expect(text).not.toMatch(/backdrop-filter|\bbackdrop-blur/);
  });
  it("text is never painted with a gradient", () => {
    const globals = ALL.find((f) => f.file.endsWith("globals.css"))!.text;
    expect(globals).not.toMatch(/background-clip:\s*text/);
  });
});
