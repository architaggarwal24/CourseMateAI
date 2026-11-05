// Idempotency keys for record-creating POSTs (a course, an exam, an invite code, a purchase, a checkout). The browser
// sends one Idempotency-Key per user action and the same key on a retry (a double click, a timeout, a flaky network).
// The first request runs and its answer is kept for 24 hours; a retry gets that answer back instead of a second
// record. While the first is still running a retry gets 409 (try again shortly). A request that fails keeps nothing,
// so it can be retried with the same key. No header: the request just runs (older clients, scripts).
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "./db";
import { idempotencyKeys } from "./db/schema";
import { HttpError } from "./http";

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
/** A run this old with no answer died with its Worker: the next request takes over. */
const STALE_RUN_MS = 2 * 60 * 1000;
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const jsonResponse = (body: string, status: number, replayed: boolean) =>
  new Response(body, {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...(replayed && { "idempotent-replayed": "true" }) },
  });

/**
 * Run `run` at most once per (scope, Idempotency-Key). `scope` is the route and the user ("courses:<user id>"), so a
 * key means nothing to another user or another route. Returns run's result when there is no key, else a Response.
 */
export async function idempotent(req: Request, db: Db, scope: string, run: () => Promise<unknown>, now = Date.now()): Promise<unknown> {
  const key = req.headers.get(IDEMPOTENCY_HEADER);
  if (key === null) return run();
  if (!KEY_SHAPE.test(key)) {
    throw new HttpError(400, "invalid_idempotency_key", "This request's Idempotency-Key is malformed. Please try again.");
  }
  const requestHash = await sha256(await req.clone().text());
  const where = and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key));

  // Claim the key. Taken already: replay its answer, or say it is still running, or take over a dead/expired one.
  const claim = () => db.insert(idempotencyKeys).values({ scope, key, requestHash, createdAt: now })
    .onConflictDoNothing().returning({ key: idempotencyKeys.key }).get();
  let claimed = await claim();
  if (!claimed) {
    const row = await db.select().from(idempotencyKeys).where(where).get();
    const expired = !row || now - row.createdAt >= IDEMPOTENCY_TTL_MS || (row.status === null && now - row.createdAt >= STALE_RUN_MS);
    if (expired) {
      await db.delete(idempotencyKeys).where(and(where, eq(idempotencyKeys.createdAt, row?.createdAt ?? -1)));
      claimed = await claim();
    } else if (row.status === null) {
      throw new HttpError(409, "idempotency_in_progress", "That's still going through. Give it a moment.", "retry");
    } else if (row.requestHash !== requestHash) {
      throw new HttpError(422, "idempotency_key_reused", "This request doesn't match the one sent with its Idempotency-Key.");
    } else {
      return jsonResponse(row.body ?? "null", row.status, true);
    }
    if (!claimed) throw new HttpError(409, "idempotency_in_progress", "That's still going through. Give it a moment.", "retry");
  }

  // Now and then, clear out keys past their 24 hours (an indexed delete; cheap).
  if (Math.random() < 0.05) await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, now - IDEMPOTENCY_TTL_MS));

  let result: unknown;
  try {
    result = await run();
  } catch (e) {
    await db.delete(idempotencyKeys).where(where);
    throw e;
  }
  const status = result instanceof Response ? result.status : 200;
  const body = result instanceof Response ? await result.clone().text() : JSON.stringify(result ?? null);
  await db.update(idempotencyKeys).set({ status, body }).where(where);
  return result instanceof Response ? result : jsonResponse(body, status, false);
}
