/** @vitest-environment node */
// Idempotency keys on record-creating POSTs: a retried request gets the first answer, not a second record.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, type Db } from "./db";
import { HttpError } from "./http";
import { IDEMPOTENCY_TTL_MS, idempotent } from "./idempotency";
import { localPlatform, type LocalPlatform } from "./test/platform";

let p: LocalPlatform;
let db: Db;
beforeEach(async () => { p = await localPlatform(); db = getDb(p.env.DB); }, 60_000);
afterEach(async () => { await p?.dispose(); });

const KEY = "b3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const req = (body: unknown, key: string | null = KEY) =>
  new Request("https://coursemate.test/api/v1/courses", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) },
  });
const thrown = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as HttpError; } throw new Error("did not throw"); };

describe("idempotent()", () => {
  it("without an Idempotency-Key it just runs (every time)", async () => {
    const run = vi.fn(async () => ({ id: 1 }));
    expect(await idempotent(req({ a: 1 }, null), db, "courses:1", run)).toEqual({ id: 1 });
    await idempotent(req({ a: 1 }, null), db, "courses:1", run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs once per key; a retry gets the first answer back, marked as replayed", async () => {
    let n = 0;
    const run = vi.fn(async () => ({ id: ++n }));
    const first = await idempotent(req({ name: "Bio" }), db, "courses:1", run) as Response;
    const again = await idempotent(req({ name: "Bio" }), db, "courses:1", run) as Response;
    expect(run).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ id: 1 });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ id: 1 });
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.headers.get("cache-control")).toBe("no-store");
  });

  it("keys are per user and route: the same key elsewhere is a new request", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    await idempotent(req({}), db, "courses:1", run);
    await idempotent(req({}), db, "courses:2", run);
    await idempotent(req({}), db, "exam-create:1", run);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("refuses the same key with a different body (422)", async () => {
    await idempotent(req({ name: "Bio" }), db, "courses:1", async () => ({ id: 1 }));
    const e = await thrown(idempotent(req({ name: "Chem" }), db, "courses:1", async () => ({ id: 2 })));
    expect(e.status).toBe(422);
    expect(e.code).toBe("idempotency_key_reused");
  });

  it("while the first is still running, a second with the same key gets 409 (try again)", async () => {
    let finish!: () => void;
    const slow = idempotent(req({}), db, "courses:1", () => new Promise((r) => { finish = () => r({ id: 1 }); }));
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const e = await thrown(idempotent(req({}), db, "courses:1", async () => ({ id: 2 })));
    expect(e.status).toBe(409);
    expect(e.code).toBe("idempotency_in_progress");
    expect(e.action).toBe("retry");
    finish();
    expect(await ((await slow) as Response).json()).toEqual({ id: 1 });
  });

  it("a request that fails keeps nothing, so a retry with the same key runs again", async () => {
    const bad = await thrown(idempotent(req({}), db, "courses:1", async () => { throw new HttpError(400, "invalid_name", "Name it."); }));
    expect(bad.code).toBe("invalid_name");
    const ok = await idempotent(req({}), db, "courses:1", async () => ({ id: 7 })) as Response;
    expect(await ok.json()).toEqual({ id: 7 });
  });

  it("a key is kept for 24 hours; after that (or once a crashed run is 2 minutes old) it runs again", async () => {
    const t0 = 1_800_000_000_000;
    const run = vi.fn(async () => ({ ok: true }));
    await idempotent(req({}), db, "courses:1", run, t0);
    await idempotent(req({}), db, "courses:1", run, t0 + IDEMPOTENCY_TTL_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    await idempotent(req({}), db, "courses:1", run, t0 + IDEMPOTENCY_TTL_MS + 1);
    expect(run).toHaveBeenCalledTimes(2);

    // a run that never finished (the Worker died): not "in progress" forever
    await p.env.DB.prepare("INSERT INTO idempotency_keys (scope, key, request_hash, status, body, created_at) VALUES (?, ?, ?, NULL, NULL, ?)")
      .bind("exam-create:1", KEY, "x", t0).run();
    const e = await thrown(idempotent(req({}), db, "exam-create:1", run, t0 + 60_000));
    expect(e.status).toBe(409);
    await idempotent(req({}), db, "exam-create:1", run, t0 + 121_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("rejects a malformed key (400)", async () => {
    for (const bad of ["short", "has spaces in it ok", "x".repeat(200)]) {
      const e = await thrown(idempotent(req({}, bad), db, "courses:1", async () => ({})));
      expect(e.status).toBe(400);
      expect(e.code).toBe("invalid_idempotency_key");
    }
  });
});
