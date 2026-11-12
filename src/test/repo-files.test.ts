// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** Files under these folders that .gitignore would keep out of a push (none should be). */
function ignoredSource(): string[] | null {
  try {
    const out = execFileSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "src", "e2e", "drizzle", "public"], { cwd: root, encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return null;                                    // not a git checkout (or no git): nothing to check
  }
}

describe("the repository", () => {
  // A bare `build/` in .gitignore once hid src/app/api/v1/hero/build/route.ts: everything passed here, and the push
  // was missing the route, so CI failed. Run before pushing (npm run check), this catches it.
  it("no source file is hidden from git by .gitignore", () => {
    const ignored = ignoredSource();
    if (ignored) expect(ignored).toEqual([]);
  });

  // scripts/remove-old-files.mjs deletes what unzipping can't. It once still listed components/play/ForgeTab.tsx
  // after a new Forge was built at that path: running it would have deleted live code.
  it("the cleanup script never names a file the app still has", () => {
    const script = readFileSync(join(root, "scripts/remove-old-files.mjs"), "utf8");
    const list = script.slice(script.indexOf("const OLD = ["), script.indexOf("];"));
    const paths = [...list.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(20);
    // (Next's generated files are rebuilt by next dev / next build, so those may exist)
    expect(paths.filter((p) => !p.startsWith(".next/") && existsSync(join(root, p)))).toEqual([]);
  });

});

/** Every file under `dir` (relative to the repo root), recursively. */
function filesIn(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
}
const topLevel = (dir: string) => readdirSync(join(root, dir)).filter((n) => !statSync(join(root, dir, n)).isDirectory());

// The layout (docs/coursemateai-context.md "Project layout"; scripts/restructure.mjs made it)
describe("the project layout", () => {
  it("no component sits loose at the top of src/components: each is in its feature's folder", () => {
    expect(topLevel("src/components")).toEqual([]);
  });

  it("only app-wide modules sit at the top of src/lib; the rest are in a feature folder", () => {
    const appWide = ["keys", "monitoring", "pwa", "routes", "sidebar", "site", "site-url", "theme", "undo", "utils", "worlds"];
    const extra = topLevel("src/lib").map((n) => n.replace(/(\.test)?\.tsx?$/, "")).filter((n) => !appWide.includes(n));
    expect(extra, "a new module belongs in a feature folder (or, if it is truly app-wide, in this list)").toEqual([]);
  });

  it("only the Worker's plumbing sits at the top of src/server; features are in their folders", () => {
    const plumbing = ["cf-bindings.d", "context", "env", "errors", "http", "idempotency", "route", "status",
      "api-not-found", "migrations", "queries", "routes", "wrangler-config"];   // (the last five: whole-server tests)
    const extra = topLevel("src/server").map((n) => n.replace(/(\.test)?\.tsx?$/, "")).filter((n) => !plumbing.includes(n));
    expect(extra).toEqual([]);
  });

  it("names: components PascalCase, hooks useX, everything else kebab-case", () => {
    const pascal = /^[A-Z][A-Za-z0-9]*$/, hook = /^use[A-Z][A-Za-z0-9]*$/, kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    const dirs = ["src/components", "src/hooks", "src/lib", "src/server", "src/styles", "src/test", "src/types", "e2e", "scripts"];
    const bad = dirs.flatMap(filesIn).filter((f) => {
      const base = f.split("/").pop()!.split(".")[0];
      if (f.startsWith("src/components/")) return !(pascal.test(base) || hook.test(base) || kebab.test(base));
      if (f.startsWith("src/hooks/")) return !hook.test(base);
      return !kebab.test(base);
    });
    expect(bad).toEqual([]);
  });
});
