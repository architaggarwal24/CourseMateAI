/** @vitest-environment node */
// No import cycles in the server code. In a cycle, whichever file the bundler happens to load first sees the others
// half-built: `export const A = B` at the top of a file then throws "Cannot access 'B' before initialization".
// Vitest loads files in another order than Next's dev server, so the tests can pass while every API route 500s
// (it happened: documents -> trash -> courses -> documents). Type-only imports are erased, so they don't count.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

// Known cycles whose files only call each other's functions later, never at load time. Keep this list short.
const ALLOWED = new Set(["server/game/progression.ts -> server/game/scrolls.ts"]);

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) serverFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$|\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (fs.existsSync(c)) return c;
  return null;
}

/** The files a file loads at runtime: `import type` and imports of only types are left out. */
export function runtimeImports(file: string, source: string): string[] {
  const deps: string[] = [];
  for (const m of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+["']([^"']+)["']/gm)) {   // [^;] crosses lines, so a multi-line import is one match
    const what = m[1].trim();
    if (/^\{[^}]*\}$/.test(what) && what.slice(1, -1).split(",").every((s) => !s.trim() || s.trim().startsWith("type "))) continue;
    const r = resolve(file, m[2]);
    if (r) deps.push(r);
  }
  return deps;
}

function cycles(): string[] {
  const files = serverFiles(path.join(SRC, "server"));
  const graph = new Map(files.map((f) => [f, runtimeImports(f, fs.readFileSync(f, "utf8"))]));
  const found = new Set<string>();
  const seen = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visit = (n: string) => {
    seen.add(n); onStack.add(n); stack.push(n);
    for (const d of graph.get(n) ?? []) {
      if (!graph.has(d)) continue;
      if (onStack.has(d)) found.add(stack.slice(stack.indexOf(d)).map((x) => path.relative(SRC, x).split(path.sep).join("/")).join(" -> "));
      else if (!seen.has(d)) visit(d);
    }
    stack.pop(); onStack.delete(n);
  };
  for (const f of files) if (!seen.has(f)) visit(f);
  return [...found].filter((c) => !ALLOWED.has(c));
}

describe("server imports", () => {
  it("type-only imports don't count, value imports do", () => {
    const f = path.join(SRC, "server/study/trash.ts");
    expect(runtimeImports(f, `import type { A } from "./courses";\nimport { type B } from "./courses";`)).toEqual([]);
    expect(runtimeImports(f, `import { C, type D } from "./courses";`)).toEqual([path.join(SRC, "server/study/courses.ts")]);
  });

  it("have no cycles", () => {
    expect(cycles()).toEqual([]);
  });
});
