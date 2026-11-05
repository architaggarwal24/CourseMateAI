// @vitest-environment node
// The client's types (generated/schema.d.ts) came from the old Python backend. Stage 4.6 deleted it, so the file is
// kept by hand now; this checks every path in it is answered by a Worker route (src/app/api/v1/...).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../../app/api", import.meta.url));
const GENERATED = fileURLToPath(new URL("./generated/schema.d.ts", import.meta.url));
// Paths the Python backend had that the Worker does not: Better Auth replaced login/register/API keys, the exam
// report is a print page, and /api/system/status replaced health/ready/providers.
const RETIRED = new Set([
  "/api/v1/auth/api-key", "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/exams/{exam_id}/report.pdf",
  "/api/v1/health", "/api/v1/ready", "/api/v1/providers",
]);

function routeFor(path: string): boolean {
  let dir = API;
  for (const seg of path.replace(/^\/api\//, "").split("/")) {
    const entries = readdirSync(dir);
    if (entries.includes(seg)) { dir = join(dir, seg); continue; }
    const dynamic = entries.find((e) => /^\[[^.]/.test(e));
    if (seg.startsWith("{") && dynamic) { dir = join(dir, dynamic); continue; }
    return false;
  }
  return existsSync(join(dir, "route.ts"));
}

describe("the API the client is typed for", () => {
  const paths = [...readFileSync(GENERATED, "utf8").matchAll(/^ {4}"(\/api\/v1\/[^"]*)": \{/gm)].map((m) => m[1]);

  it("is all under /api/v1", () => {
    expect(paths.length).toBeGreaterThan(30);
  });

  it("has a Worker route for every path still in use", () => {
    expect(paths.filter((p) => !RETIRED.has(p) && !routeFor(p))).toEqual([]);
  });

  it("the retired paths really are gone", () => {
    for (const p of RETIRED) expect(routeFor(p), p).toBe(false);
  });
});
