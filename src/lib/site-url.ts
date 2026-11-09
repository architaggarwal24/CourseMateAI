// The canonical origin check (SEO P0), on its own so next.config.ts can import it without the rest of the site's
// metadata (src/lib/site.ts). See site.ts for what NEXT_PUBLIC_SITE_URL is and where it's set.
const DEV_ORIGIN = "http://localhost:3000";
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

/**
 * The canonical origin from `raw` (NEXT_PUBLIC_SITE_URL): an absolute https URL with no path, query or hash, and in
 * production never a local host. Throws a clear error otherwise.
 */
export function parseSiteUrl(raw: string | undefined, production: boolean): URL {
  const value = (raw ?? "").trim();
  if (!value) {
    if (production) throw new Error("NEXT_PUBLIC_SITE_URL must be set for a production build (e.g. https://coursemateai.architaggarwal.workers.dev).");
    return new URL(DEV_ORIGIN);
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`NEXT_PUBLIC_SITE_URL is not a valid URL: "${value}".`); }
  const local = LOCAL.test(url.hostname);
  if (production && local) throw new Error(`NEXT_PUBLIC_SITE_URL can't be a local address in production: "${value}".`);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error(`NEXT_PUBLIC_SITE_URL must use https: "${value}".`);
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password) {
    throw new Error(`NEXT_PUBLIC_SITE_URL must be just the origin (no path, query or credentials): "${value}".`);
  }
  return new URL(url.origin);
}

