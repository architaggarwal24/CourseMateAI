/** @vitest-environment node */
// Security fix #10: the session secret fails closed (Workers have no NODE_ENV at run time).
import { describe, expect, it } from "vitest";
import { secretFrom } from ".";

const REAL = "x".repeat(40);

describe("the session secret", () => {
  it("uses the configured secret", () => {
    expect(secretFrom({ BETTER_AUTH_SECRET: `  ${REAL}  ` })).toBe(REAL);
  });

  it.each([undefined, "", "production", "staging"])("refuses to run without one when NODE_ENV is %s (the live site)", (env) => {
    expect(() => secretFrom({ NODE_ENV: env })).toThrow(/BETTER_AUTH_SECRET must be set/);
    expect(() => secretFrom({ NODE_ENV: env, BETTER_AUTH_SECRET: "too-short" })).toThrow(/BETTER_AUTH_SECRET must be set/);
  });

  it.each(["development", "test"])("lets %s run with the placeholder", (env) => {
    expect(secretFrom({ NODE_ENV: env })).toMatch(/dev-only/);
  });
});
