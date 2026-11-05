import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" || name === "node_modules" ? [] : sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.dev\.tsx$/.test(name) ? [full] : [];
  });
}

/** The text of every `catch ... { ... }` block (brace-matched). */
function catchBlocks(text: string): string[] {
  const blocks: string[] = [];
  const re = /\bcatch\b\s*(\([^)]*\))?\s*\{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 1, i = re.lastIndex;
    while (i < text.length && depth > 0) { if (text[i] === "{") depth++; else if (text[i] === "}") depth--; i++; }
    blocks.push(text.slice(re.lastIndex, i - 1));
  }
  return blocks;
}

describe("one error pattern", () => {
  const files = sources(SRC);

  it("no catch block raises toast.error() - failures go through toast.apiError() / <ErrorState>", () => {
    const offenders = files.flatMap((f) =>
      catchBlocks(readFileSync(f, "utf8")).filter((b) => /toast\.error\(/.test(b)).map(() => relative(SRC, f)));
    expect(offenders).toEqual([]);
  });

  it("no failed-request branch shows a raw server/exception message in a toast", () => {
    const offenders = files.filter((f) => /toast\.error\([^)]*\b(e|err|error)\??\.message/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the old quota event hack is gone", () => {
    const offenders = files.filter((f) => /cmai:quota|cmai_quota_hit/.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
