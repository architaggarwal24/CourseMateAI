// Plain-string settings. On Cloudflare they come from the Worker's variables (process.env is filled from them);
// under `next dev` / `next start` from the environment as usual.

/** The Python backend that still answers the areas not moved to the Worker yet ("" = none). */
export function backendUrl(env: Record<string, string | undefined> = process.env): string {
  const url = (env.BACKEND_URL || env.NEXT_PUBLIC_API_URL || env.NEXT_PUBLIC_BACKEND_URL || "").trim();
  if (url) return url.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? "" : "http://localhost:8000";
}

/** Shared with the backend so it believes the client address the Worker names (32+ characters, or unset). */
export function proxySecret(env: Record<string, string | undefined> = process.env): string {
  return (env.PROXY_SECRET || "").trim();
}
