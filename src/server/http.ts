// Small pieces every Worker route shares: an error that becomes the API's error shape, JSON bodies, the
// same-site check for changes, and fixed-window rate limits kept in D1 (so every Worker instance shares them).
import { eq, sql } from "drizzle-orm";
import type { ApiErrorAction } from "@/lib/api/errors";
import type { Db } from "./db";
import { apiRateLimits } from "./db/schema";
import { apiError } from "./errors";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public action: ApiErrorAction = null,
    public details: Record<string, unknown> | null = null,
    public headers?: HeadersInit,
  ) {
    super(message);
  }
}

export function toResponse(e: unknown): Response {
  if (e instanceof HttpError) return apiError(e.status, e.code, e.message, e.action, e.details, e.headers);
  console.error("[coursemate] unhandled error", e);
  return apiError(500, "internal_error", "Something went wrong on our side. Please try again.", "retry");
}

/** Run a route, turning thrown HttpErrors (and anything unexpected) into the API's error shape. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    return toResponse(e);
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const body = await req.json();
    if (body && typeof body === "object") return body as T;
  } catch { /* fall through */ }
  throw new HttpError(422, "validation_error", "Some of the information you entered is invalid.");
}

/** A change (POST/PUT/PATCH/DELETE) must come from this site: a browser sends Origin, and it must match. */
export function assertSameOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    throw new HttpError(403, "bad_origin", "This request didn't come from CourseMateAI.");
  }
}

export function clientIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
}

const windowOf = (now: number, windowSeconds: number) => Math.floor(now / 1000 / windowSeconds) * windowSeconds;

/** Count one more hit for `key` in the current fixed window (one atomic upsert); the new count. */
export async function bumpCounter(db: Db, key: string, windowSeconds: number, now = Date.now()): Promise<number> {
  const windowStart = windowOf(now, windowSeconds);
  const row = await db.insert(apiRateLimits).values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: apiRateLimits.key,
      set: {
        count: sql`CASE WHEN ${apiRateLimits.windowStart} = ${windowStart} THEN ${apiRateLimits.count} + 1 ELSE 1 END`,
        windowStart,
      },
    })
    .returning({ count: apiRateLimits.count }).get();
  return row?.count ?? 1;
}

/** The hits counted for `key` in the current window, without counting one. */
export async function peekCounter(db: Db, key: string, windowSeconds: number, now = Date.now()): Promise<number> {
  const row = await db.select().from(apiRateLimits).where(eq(apiRateLimits.key, key)).get();
  return row && row.windowStart === windowOf(now, windowSeconds) ? row.count : 0;
}

export async function clearCounter(db: Db, key: string): Promise<void> {
  await db.delete(apiRateLimits).where(eq(apiRateLimits.key, key));
}

/** Seconds until the current window for `windowSeconds` ends. */
export const windowLeft = (windowSeconds: number, now = Date.now()) => windowOf(now, windowSeconds) + windowSeconds - Math.floor(now / 1000);

/** Allow `limit` hits per `windowSeconds` for `key`; over that, 429 rate_limited with retry_after_seconds. */
export async function rateLimit(db: Db, key: string, limit: number, windowSeconds: number, now = Date.now()): Promise<void> {
  const windowStart = windowOf(now, windowSeconds);
  const count = await bumpCounter(db, key, windowSeconds, now);
  if (count > limit) {
    const retry = windowStart + windowSeconds - Math.floor(now / 1000);
    throw new HttpError(429, "rate_limited", "Too many tries. Please wait a moment and try again.", "retry",
      { retry_after_seconds: retry }, { "retry-after": String(retry) });
  }
}
