import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { LEGACY_REDIRECTS, STUDY_TAB_PATH_SOURCE, STUDY_UNKNOWN_TAB_SOURCE } from "./src/lib/routes";
import { parseSiteUrl } from "./src/lib/site-url";

// The canonical address (src/lib/site.ts): a production build stops here, with a clear message, when
// NEXT_PUBLIC_SITE_URL is missing, not https, local, or has a path. (`next dev` falls back to localhost.)
if (process.env.NODE_ENV === "production") parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, true);

// Private and utility pages: never indexed, said in the response header as well as the page's meta tag (the
// header also covers anything that isn't HTML). The public pages are listed in src/lib/site.ts PUBLIC_PAGES.
const NOINDEX_PATHS = ["/today", "/study", "/quests", "/arena", "/bestiary", "/champion", "/adventurer", "/hero", "/account", "/login", "/offline", "/api"];

// The API: the browser only ever calls this site (/api/*), answered by the Worker's routes under src/app/api/
// (an unknown path is a JSON 404). One site, so no CORS and a first-party cookie.

const nextConfig: NextConfig = {
  // This folder is the project root, even when a parent folder has its own package-lock.json (otherwise Turbopack
  // guesses the parent and warns about "multiple lockfiles").
  turbopack: { root: typeof __dirname !== "undefined" ? __dirname : process.cwd() },
  // A self-contained server (.next/standalone) so the Docker image ships no node_modules.
  output: "standalone",
  // `next dev`'s badge sits bottom-right: bottom-left it covered the Hero panel's sound and profile buttons.
  devIndicators: { position: "bottom-right" },
  // The old top-level pages now live under /study, /hero and /account (src/lib/routes.ts). The query string is kept.
  async redirects() {
    return [
      ...LEGACY_REDIRECTS.map(({ from, to }) => ({ source: from, destination: to, permanent: false })),
      // The active Study tab lives in the query string: /study/quiz -> /study?tab=quiz
      { source: STUDY_TAB_PATH_SOURCE, destination: "/study?tab=:tab", permanent: false },
      // /study/<anything but a tab> -> /study (a real redirect rather than a 404)
      { source: STUDY_UNKNOWN_TAB_SOURCE, destination: "/study", permanent: false },
    ];
  },
  // Security headers on every page (the API sets its own, stricter ones). No script-src rules: Next's own inline
  // scripts and Razorpay Checkout must run; framing and plugins are what this shuts. HSTS is the HTTPS front end's.
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\" \"https://api.razorpay.com\")" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    ];
    const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];
    return [
      { source: "/:path*", headers: common },
      ...NOINDEX_PATHS.flatMap((p) => [{ source: p, headers: noindex }, { source: `${p}/:path*`, headers: noindex }]),
      // The service worker is never cached, so a new version reaches everyone on their next visit.
      { source: "/sw.js", headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ] },
    ];
  },
};

export default nextConfig;

// `next dev` gets the Worker's bindings (D1, R2) from wrangler's local platform (wrangler.jsonc).
if (process.env.NODE_ENV === "development") initOpenNextCloudflareForDev();
