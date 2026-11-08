/** @vitest-environment node */
import { afterEach, describe, expect, it } from "vitest";
import { fillProcessEnv } from "./env";

// Local dev: `next dev` loads .env.local into process.env, but the Worker settings in .dev.vars (OWNER_EMAIL,
// BETTER_AUTH_SECRET, the AI keys ...) only reach the Cloudflare context. The server reads process.env, so the owner
// was never recognised locally (no admin, no Archmage) while the deployed site, where OpenNext copies them, was fine.
const KEYS = ["CMAI_TEST_OWNER", "CMAI_TEST_SET", "CMAI_TEST_BINDING"];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });

describe("Worker settings reach process.env", () => {
  it("copies text settings that process.env doesn't have", () => {
    fillProcessEnv({ CMAI_TEST_OWNER: "owner@example.com" });
    expect(process.env.CMAI_TEST_OWNER).toBe("owner@example.com");
  });

  it("never overwrites what is already set (.env.local or the real environment wins)", () => {
    process.env.CMAI_TEST_SET = "from-env-local";
    fillProcessEnv({ CMAI_TEST_SET: "from-dev-vars" });
    expect(process.env.CMAI_TEST_SET).toBe("from-env-local");
  });

  it("skips bindings (D1, R2, AI are objects, not settings)", () => {
    fillProcessEnv({ CMAI_TEST_BINDING: { prepare() {} } } as unknown as Record<string, unknown>);
    expect(process.env.CMAI_TEST_BINDING).toBeUndefined();
  });
});
