/** @vitest-environment node */
// GET /api/system/status: is the Worker wired up (database, file storage, the backend still being moved)?
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { systemStatus } from "./status";
import { localPlatform, type LocalPlatform } from "./test/platform";

let platform: LocalPlatform;
beforeAll(async () => { platform = await localPlatform(); }, 60_000);
afterAll(async () => { await platform?.dispose(); });

const GOOD = { BETTER_AUTH_SECRET: "x".repeat(32), OWNER_EMAIL: "o@x.io" };
const backendOk = (async () => new Response('{"status":"ok"}')) as unknown as typeof fetch;

describe("systemStatus", () => {
  it("checks the migrated database, the bucket and the backend", async () => {
    const s = await systemStatus(platform.env, { backendUrl: "http://b", fetchImpl: backendOk, settings: GOOD });
    expect(s).toMatchObject({
      ok: true,
      runtime: "cloudflare",
      database: { ok: true },
      storage: { ok: true },
      backend: { configured: true, ok: true },
    });
  });

  it("is not ok when the database has not been migrated", async () => {
    const env = { ...platform.env, DB: { prepare: () => ({ first: async () => null }) } as unknown as D1Database };
    const s = await systemStatus(env, { backendUrl: "", fetchImpl: backendOk });
    expect(s.ok).toBe(false);
    expect(s.database).toEqual({ ok: false, detail: "not migrated: run npm run db:migrate:remote" });
    expect(s.backend).toEqual({ configured: false, ok: false });
  });

  it("reports a backend that does not answer without failing the Worker", async () => {
    const down = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const s = await systemStatus(platform.env, { backendUrl: "http://b", fetchImpl: down, settings: GOOD });
    expect(s.ok).toBe(true);                         // the Worker itself is fine
    expect(s.backend).toEqual({ configured: true, ok: false });
  });

  it("is not ok without the accounts secret, and says there is no admin without OWNER_EMAIL", async () => {
    expect((await systemStatus(platform.env, { backendUrl: "", fetchImpl: backendOk, settings: {} })).accounts)
      .toEqual({ ok: false, detail: "set BETTER_AUTH_SECRET (32+ characters)" });
    const s = await systemStatus(platform.env, { backendUrl: "", fetchImpl: backendOk, settings: { BETTER_AUTH_SECRET: "x".repeat(40) } });
    expect(s.ok).toBe(true);
    expect(s.accounts?.detail).toMatch(/no OWNER_EMAIL/);
  });

  it("outside Cloudflare (next start, Docker) only the backend is checked", async () => {
    const s = await systemStatus(null, { backendUrl: "http://b", fetchImpl: backendOk });
    expect(s).toMatchObject({ ok: true, runtime: "node", backend: { ok: true } });
    expect(s.database).toBeUndefined();
  });
});
