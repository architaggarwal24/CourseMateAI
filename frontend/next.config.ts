import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { LEGACY_REDIRECTS, STUDY_TAB_PATH_SOURCE, STUDY_UNKNOWN_TAB_SOURCE } from "./src/lib/routes";

// The backend: the browser only ever calls this site (/api/*). Routes moved to TypeScript answer under
// src/app/api/; everything else is forwarded to the Python backend by src/app/api/[...path]/route.ts
// (BACKEND_URL, read when a request arrives, not when the app is built). One site, so no CORS and a first-party cookie.

// Dev-only pages are files named page.dev.tsx (e.g. src/app/dev/kit/page.dev.tsx). They are routes only while
// `next dev` runs: a production build does not count "dev.tsx" as a page extension, so they are not built or served.
const PAGE_EXTENSIONS = ["tsx", "ts", "jsx", "js", ...(process.env.NODE_ENV === "production" ? [] : ["dev.tsx"])];

const nextConfig: NextConfig = {
  // This folder is the project root, even when a parent folder has its own package-lock.json (otherwise Turbopack
  // guesses the parent and warns about "multiple lockfiles").
  turbopack: { root: typeof __dirname !== "undefined" ? __dirname : process.cwd() },
  pageExtensions: PAGE_EXTENSIONS,
  // A self-contained server (.next/standalone) so the Docker image ships no node_modules.
  output: "standalone",
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
    return [
      { source: "/:path*", headers: common },
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
