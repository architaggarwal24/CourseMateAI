// How sign-in works on this server (GET /api/v1/auth/config): Google on or off, and whether emails really go out.
export interface AuthConfig {
  google: boolean;
  email_delivery: boolean;
  verification_required: boolean;
  invite_only: boolean;
}

const FALLBACK: AuthConfig = { google: false, email_delivery: false, verification_required: false, invite_only: false };
let cached: Promise<AuthConfig> | null = null;

export function fetchAuthConfig(): Promise<AuthConfig> {
  cached ??= fetch("/api/v1/auth/config", { credentials: "same-origin" })
    .then(async (r) => (r.ok ? ({ ...FALLBACK, ...(await r.json()) } as AuthConfig) : FALLBACK))
    .catch(() => { cached = null; return FALLBACK; });
  return cached;
}

/** Tests start from a clean cache. */
export function resetAuthConfigCache(): void {
  cached = null;
}
