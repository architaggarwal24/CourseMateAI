import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

describe("avatar rendering stays consolidated", () => {
  // paths with forward slashes on every OS (Windows gives backslashes)
  const sources = files(SRC).map((p) => ({ p: p.replace(SRC, "").replace(/\\/g, "/"), s: readFileSync(p, "utf8") }));

  it("only lib/avatar/render.ts blits sprite pixels", () => {
    // (The arena's fighters are not avatars: lib/pixel rasterises the pixel-fighter sprites and draws the fight.)
    const painters = sources.filter(({ p, s }) => !p.startsWith("/lib/arena/") && !p.startsWith("/lib/pixel/") && /\.fillRect\(/.test(s) && /sprite|SpriteData/i.test(s)).map((x) => x.p);
    expect(painters).toEqual(["/lib/avatar/render.ts"]);
  });

  it("no TS file holds sprite pixel rows (they live in lib/avatar/data/*.json)", () => {
    const withRows = sources.filter(({ s }) => /\[\s*(["'`])[.#0-9A-Za-z]{12,}\1\s*,\s*(["'`])[.#0-9A-Za-z]{12,}\2/.test(s)).map((x) => x.p);
    expect(withRows).toEqual([]);
  });
});
