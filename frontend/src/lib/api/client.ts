// The ONLY place that talks HTTP to the backend. Everything else goes through `api` / `rawApi`
// (or the domain functions in ../api.ts), so there is exactly one base URL, one error
// parser and one set of global side effects.
//
// Types come from the backend's OpenAPI schema:  npm run gen:api  ->  ./generated/schema.d.ts
import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";
import { ApiError, parseApiError } from "./errors";

/**
 * The browser never talks to the backend directly: every call goes to THIS origin under /api/*, and the Next.js
 * rewrite in next.config.ts forwards it to the backend (BACKEND_URL). So there is no CORS, and the login cookie
 * (HttpOnly, SameSite=Lax, Secure over https) belongs to the site the user is actually on.
 * (Server-side rendering has no origin to be relative to, so it names the backend itself.)
 */
const SERVER_SIDE_BACKEND = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");

export const API_PREFIX = "/api/v1";

/** Raised on window when a request fails because its document is gone (expired, removed or never uploaded). */
export const DOCUMENT_GONE_EVENT = "cmai:document-gone";

/** The generated `paths`, keyed relative to /api/v1 so call sites read api.GET("/shop"). */
export type V1Paths = {
  [K in keyof paths as K extends `${typeof API_PREFIX}${infer Rest}` ? Rest : K]: paths[K];
};

// (An absolute URL on the page's own origin: `Request` objects need one outside a real browser too.)
const baseUrl = `${typeof window === "undefined" ? SERVER_SIDE_BACKEND : window.location.origin}${API_PREFIX}`;
// Look fetch up at call time (not import time) so it can be swapped in tests.
const rawFetch = (request: Request) => globalThis.fetch(request);

const EXPECTED_CODES = new Set([
  "session_expired", "document_not_found", "battle_in_progress", "not_enough_focus", "invalid_move",
  "question_not_current", "battle_finished", "choice_pending", "node_unreachable",
]);

/**
 * Plain typed client: never throws on HTTP errors and has no side effects. Returns
 * { data, error, response } so the caller decides what a 401 / 4xx means (login form,
 * "am I logged in?" probe, optional data, ...).
 */
export const rawApi = createClient<V1Paths>({ baseUrl, credentials: "include", fetch: rawFetch });

// ── Guarded client ────────────────────────────────────────────────────────────

// In-flight deduplication: while an identical GET is pending, share its response instead
// of firing a second network request. Mutations always fire.
const inFlight = new Map<string, Promise<Response>>();

/** Where requests go (this origin's /api/v1). Exported for the one call that streams (lib/chatStream.ts). */
export const API_BASE_URL = baseUrl;

async function failWith(res: Response): Promise<never> {
  const body = await res.clone().json().catch(() => null);
  const apiErr = parseApiError(res.status, body, undefined, res.headers.get("Retry-After"));

  // The server no longer has the document the request was about: let the Study workspace re-check it and
  // show its "upload it again" state instead of each screen failing on its own.
  if (typeof window !== "undefined" && (apiErr.code === "session_expired" || apiErr.code === "document_not_found")) {
    window.dispatchEvent(new CustomEvent(DOCUMENT_GONE_EVENT));
  }

  // Not logged in (or the login expired): back to the login page.
  if (res.status === 401 && (apiErr.action === "relogin" || apiErr.code === "unknown")) {
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new ApiError(401, {
      code: apiErr.code, action: "relogin", details: apiErr.details,
      message: "Session expired. Please log in again.",
    });
  }
  // A warning, not an error: the caller shows the failure (toast / error state), and in development console.error
  // would also pop Next's full-screen error overlay over a failure the screen already handles.
  // Expected outcomes the screens already explain (a document that expired, a refused move...) stay out of the
  // console; anything else is logged once as a warning for debugging.
  if (res.status >= 500 || !EXPECTED_CODES.has(apiErr.code)) console.warn(`API error ${res.status}:`, body);
  throw apiErr;
}

async function guardedFetch(request: Request): Promise<Response> {
  const isGet = request.method === "GET";
  const key = request.url;
  let pending = isGet ? inFlight.get(key) : undefined;
  if (!pending) {
    pending = (async () => {
      const res = await globalThis.fetch(request);
      if (!res.ok) await failWith(res);
      return res;
    })();
    if (isGet) {
      inFlight.set(key, pending);
      const done = () => { inFlight.delete(key); };
      pending.then(done, done);
    }
  }
  // Hand every caller its own copy so each can read the body.
  return (await pending).clone();
}

/**
 * Typed client for app code: resolves with `data`, and on any HTTP error THROWS an ApiError
 * after applying the global behaviour (401 -> /login, a vanished document -> DOCUMENT_GONE_EVENT).
 */
export const api = createClient<V1Paths>({ baseUrl, credentials: "include", fetch: guardedFetch });

/** The global behaviour for a failed response (401 -> /login, a vanished document ...), then throws the ApiError. */
export { failWith as throwForResponse };
