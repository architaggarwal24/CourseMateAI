// The Better Auth session cookie's names (cookiePrefix "coursemate"; on https Better Auth adds the __Secure- prefix).
// Only its presence is checked, to send a visitor to the right page first: it proves nothing, and every API route
// still checks the session itself.
export const SESSION_COOKIES = ["__Secure-coursemate.session_token", "coursemate.session_token"] as const;

export function hasSessionCookie(get: (name: string) => { value?: string } | undefined): boolean {
  return SESSION_COOKIES.some((n) => !!get(n)?.value);
}

/**
 * Where to go after signing in: an internal path from ?next= (an app page), else Today. Anything else is ignored: an
 * absolute URL, a protocol-relative "//host", a backslash trick or the login page itself (security fix #19 style).
 */
export function safeNext(raw: string | null | undefined, fallback: string): string {
  const v = (raw ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f]/.test(v)) return fallback;
  if (v === "/" || v.startsWith("/login")) return fallback;
  return v.slice(0, 500);
}
