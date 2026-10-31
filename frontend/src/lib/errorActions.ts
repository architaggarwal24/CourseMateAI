// One place that decides what the user is told, and which button they are offered, for a failed request.
// Both the inline <ErrorState> and `toast.apiError()` read this, so a code looks and behaves the same everywhere.
//
//   provider_key_rejected    -> "Open Settings"            (the key was refused: fix it in Settings)
//   provider_quota           -> "Check usage" link         (the provider's usage page; Settings when it gave none)
//   provider_unreachable     -> "Retry"
//   session_expired          -> "Re-upload"                (the server no longer has the document)
//   unauthenticated          -> "Log in"
//   rate_limited             -> "Retry" after a countdown  (from Retry-After)
//
// Any other code falls back to the `action` field the server sent (settings / relogin / retry / reupload).
import { ApiError, type ApiErrorAction } from "@/lib/api/errors";
import { ROUTES } from "@/lib/routes";

export type ErrorActionKind = "settings" | "usage" | "retry" | "reupload" | "login";

export interface ErrorAction {
  kind: ErrorActionKind;
  label: string;
  /** Set for the actions that are a link (settings, usage, login); retry / reupload are done by the screen. */
  href?: string;
  /** The link leaves the app (the provider's usage page). */
  external?: boolean;
}

export interface ErrorInfo {
  code: string;
  message: string;
  action: ErrorAction | null;
  /** rate_limited: seconds to wait before the retry is allowed. */
  retryAfter: number | null;
}

/** Used when a 429 carries no Retry-After at all. */
export const DEFAULT_RETRY_AFTER = 5;

export const NETWORK_ERROR_MESSAGE = "Couldn't reach the server. Check your connection and try again.";

const SETTINGS: ErrorAction = { kind: "settings", label: "Open Settings", href: ROUTES.accountSettings };
const LOGIN: ErrorAction = { kind: "login", label: "Log in", href: ROUTES.login };
const RETRY: ErrorAction = { kind: "retry", label: "Retry" };
const REUPLOAD: ErrorAction = { kind: "reupload", label: "Re-upload" };

const BY_SERVER_ACTION: Record<Exclude<ApiErrorAction, null>, ErrorAction> = {
  settings: SETTINGS, relogin: LOGIN, retry: RETRY, reupload: REUPLOAD,
};

function usageAction(err: ApiError): ErrorAction {
  return err.usageUrl
    ? { kind: "usage", label: "Check usage", href: err.usageUrl, external: true }
    : SETTINGS;
}

export function describeError(err: unknown, fallbackMessage?: string): ErrorInfo {
  // Not an API error: the request never got an answer (offline, DNS, a dropped connection ...). The raw text of
  // such an error ("Failed to fetch") means nothing to the user, so it is never shown.
  if (!(err instanceof ApiError)) {
    return { code: "network_error", message: fallbackMessage ?? NETWORK_ERROR_MESSAGE, action: RETRY, retryAfter: null };
  }

  let code = err.code;
  let message = err.message;
  // A 429 with no error body at all is still "slow down".
  if (code === "unknown" && err.status === 429) {
    code = "rate_limited";
    message = "Too many requests. Please try again shortly.";
  }

  switch (code) {
    case "provider_key_rejected":
      return { code, message, action: SETTINGS, retryAfter: null };
    case "provider_quota":
      return { code, message, action: usageAction(err), retryAfter: null };
    case "provider_unreachable":
      return { code, message, action: RETRY, retryAfter: null };
    case "session_expired":
      return { code, message, action: REUPLOAD, retryAfter: null };
    case "unauthenticated":
      return { code, message, action: LOGIN, retryAfter: null };
    case "rate_limited":
      return { code, message, action: RETRY, retryAfter: err.retryAfter ?? DEFAULT_RETRY_AFTER };
    default:
      return { code, message, action: err.action ? BY_SERVER_ACTION[err.action] : null, retryAfter: null };
  }
}

/** The same info without the given buttons: a screen that IS where a button leads (Settings) doesn't offer to go there. */
export function withoutActions(info: ErrorInfo, kinds?: ErrorActionKind[]): ErrorInfo {
  return info.action && kinds?.includes(info.action.kind) ? { ...info, action: null, retryAfter: null } : info;
}
