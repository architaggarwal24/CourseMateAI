// ── Error contract ────────────────────────────────────────────────────────────
// Every non-2xx response from the backend has this body (see backend/errors.py):
//   { "error": { "code": string, "message": string, "action": ApiErrorAction, "details": object | null } }
// This file is the only place that knows that shape; everything else uses ApiError / apiErrorMessage.
export type ApiErrorAction = "settings" | "relogin" | "retry" | "reupload" | null;

export interface ApiErrorPayload {
  code: string;
  message: string;
  action: ApiErrorAction;
  details: Record<string, any> | null;
}

const ACTIONS = ["settings", "relogin", "retry", "reupload"];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly action: ApiErrorAction;
  readonly details: Record<string, any> | null;
  // Convenience fields read out of `details` (provider_quota: usage_url / provider).
  readonly usageUrl: string;
  readonly provider: string;
  /** Whole seconds to wait before retrying (rate_limited): details.retry_after_seconds, else the Retry-After header. */
  readonly retryAfter: number | null;

  constructor(status: number, payload: ApiErrorPayload, retryAfterHeader?: string | null) {
    super(payload.message);
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.action = payload.action;
    this.details = payload.details;
    this.usageUrl = String(payload.details?.usage_url ?? "");
    this.provider = String(payload.details?.provider ?? "");
    this.retryAfter = readSeconds(payload.details?.retry_after_seconds) ?? readSeconds(retryAfterHeader);
  }
}

/** A non-negative whole number of seconds out of a number or a numeric string; null for anything else. */
function readSeconds(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : null;
}

/** Reads {"error": {...}} out of a parsed JSON body; null if the body isn't in the contract shape. */
function readPayload(body: unknown): ApiErrorPayload | null {
  const e = (body as any)?.error;
  if (!e || typeof e !== "object" || typeof e.message !== "string") return null;
  return {
    code: typeof e.code === "string" ? e.code : "unknown",
    message: e.message,
    action: ACTIONS.includes(e.action) ? e.action : null,
    details: e.details && typeof e.details === "object" ? e.details : null,
  };
}

/** Turn a failed response (status + parsed body, or null if it wasn't JSON) into an ApiError. */
export function parseApiError(
  status: number, body: unknown, fallbackMessage?: string, retryAfterHeader?: string | null,
): ApiError {
  return new ApiError(
    status,
    readPayload(body) ?? {
      code: "unknown",
      message: fallbackMessage ?? `Request failed with status ${status}`,
      action: null,
      details: null,
    },
    retryAfterHeader,
  );
}

/** The user-facing message of an error body, or `fallback` when the body isn't an error. For code that calls fetch() directly. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  return readPayload(body)?.message ?? fallback;
}
