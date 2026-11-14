/** @vitest-environment node */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { redact, warn } from "./log";

// The speed and reliability pass (BreakingBreach AI security checklist, control 24 and core test 12).
describe("server logs are scrubbed", () => {
  it("an email, a key, a bearer token or a password in a message becomes a placeholder (core test 12)", () => {
    const line = redact("sign-in failed for jane@example.test with key sk-demo-1234567890abcdef, Authorization: Bearer abc.def-ghi, password=hunter22 and nvapi-AAAAAAAAAAAAAAAA");
    expect(line).toBe("sign-in failed for [email] with key [key], Authorization: [redacted] [token], password=[redacted] and [key]");
    expect(redact("battle 3f2a: phase 2 questions failed: 429 rate limited")).toBe("battle 3f2a: phase 2 questions failed: 429 rate limited");
  });

  it("warn() scrubs every part it is given, errors and objects too", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warn("[x] failed", new Error("no user bob@example.test"), { to: "a@b.io" });
    expect(spy.mock.calls[0]).toEqual(["[x] failed", "Error: no user [email]", '{"to":"[email]"}']);
    spy.mockRestore();
  });

  it("server code logs through it, never console.* directly", () => {
    const root = join(__dirname);
    const files = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((n) => {
        const f = join(dir, n);
        return statSync(f).isDirectory() ? (n === "test" ? [] : walk(f)) : /\.ts$/.test(n) && !/\.test\.ts$/.test(n) && n !== "log.ts" ? [f] : [];
      });
    })(root);
    const offenders = files.filter((f) => /\bconsole\.(log|warn|error|info)\b/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([]);
  });
});
