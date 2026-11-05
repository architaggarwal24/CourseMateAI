/** @vitest-environment node */
// GET /api/system/status: is the Worker wired up (database, file storage, search, AI, accounts)?
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemStatus } from "./status";
import { localPlatform, type LocalPlatform } from "./test/platform";

let platform: LocalPlatform;
beforeAll(async () => { platform = await localPlatform(); }, 60_000);
afterAll(async () => { await platform?.dispose(); });

const GOOD = { BETTER_AUTH_SECRET: "x".repeat(32), OWNER_EMAIL: "o@x.io" };

describe("systemStatus", () => {
  it("checks the migrated database, the bucket and search; there is no backend any more", async () => {
    const s = await systemStatus(platform.env, { settings: GOOD });
    expect(s).toMatchObject({
      ok: true,
      runtime: "cloudflare",
      database: { ok: true },
      storage: { ok: true },
      search: { ok: true },
    });
    expect(s).not.toHaveProperty("backend");
  });

  it("is not ok when the database has not been migrated", async () => {
    const env = { ...platform.env, DB: { prepare: () => ({ first: async () => null }) } as unknown as D1Database };
    const s = await systemStatus(env, { settings: GOOD });
    expect(s.ok).toBe(false);
    expect(s.database).toEqual({ ok: false, detail: "not migrated: run npm run db:migrate:remote" });
  });

  it("is not ok without the accounts secret, and says there is no admin without OWNER_EMAIL", async () => {
    expect((await systemStatus(platform.env, { settings: {} })).accounts)
      .toEqual({ ok: false, detail: "set BETTER_AUTH_SECRET (32+ characters)" });
    const s = await systemStatus(platform.env, { settings: { BETTER_AUTH_SECRET: "x".repeat(40) } });
    expect(s.ok).toBe(true);
    expect(s.accounts?.detail).toMatch(/no OWNER_EMAIL/);
  });

  it("outside Cloudflare there are no bindings, so it is not ok", async () => {
    const s = await systemStatus(null, { settings: GOOD });
    expect(s).toEqual({ ok: false, runtime: "node" });
  });
});
