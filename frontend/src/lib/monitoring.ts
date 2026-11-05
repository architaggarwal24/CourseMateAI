// Error monitoring with Sentry (Phase 3 Stage 4d; docs/archive/security.md). Off unless NEXT_PUBLIC_SENTRY_DSN is set at
// build time. Nothing personal or secret is sent: no cookies, request headers or query strings, no user email or IP,
// and anything that looks like a provider key, a Razorpay key or a Fernet token is replaced with [redacted].
import type { ErrorEvent, EventHint } from "@sentry/browser";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || "";
export const SECRET_RE =
  /(sk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|nvapi-[A-Za-z0-9_-]{12,}|rzp_(?:test|live)_[A-Za-z0-9]{8,}|gAAAAA[A-Za-z0-9_\-=]{10,}|Bearer\s+[A-Za-z0-9._-]+)/g;

function clean<T>(v: T, depth = 0): T {
  if (depth > 8) return v;
  if (typeof v === "string") return v.replace(SECRET_RE, "[redacted]") as T;
  if (Array.isArray(v)) return v.map((x) => clean(x, depth + 1)) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) =>
      [k, /pass|secret|token|key|signature|cookie|auth/i.test(k) ? "[redacted]" : clean(x, depth + 1)])) as T;
  }
  return v;
}
const noQuery = (url?: string) => (url ? url.split(/[?#]/)[0] : url);

/** Sentry's beforeSend: strip what could identify a user or unlock anything. Exported for tests. */
export function scrubEvent(event: ErrorEvent, _hint?: EventHint): ErrorEvent {
  if (event.request) {
    event.request = { url: noQuery(event.request.url), method: event.request.method };
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {};
  if (event.exception) event.exception = clean(event.exception);
  if (event.message) event.message = clean(event.message);
  if (event.extra) event.extra = clean(event.extra);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => clean({ ...b, data: b.data?.url ? { ...b.data, url: noQuery(String(b.data.url)) } : b.data }));
  }
  return event;
}

let started = false;
let sentry: typeof import("@sentry/browser") | null = null;

/** Start monitoring once, in the browser, when a DSN is configured (the SDK is loaded only then). */
export async function initMonitoring(): Promise<boolean> {
  if (started || !DSN || typeof window === "undefined") return false;
  started = true;
  sentry = await import("@sentry/browser");
  sentry.init({
    dsn: DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "production",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  });
  return true;
}

/** Report an error caught by a boundary (no-op when monitoring is off). */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  sentry?.captureException(error, context ? { extra: clean(context) } : undefined);
}
