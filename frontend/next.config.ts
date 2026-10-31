import type { NextConfig } from "next";
import { LEGACY_REDIRECTS, STUDY_TAB_PATH_SOURCE, STUDY_UNKNOWN_TAB_SOURCE } from "./src/lib/routes";

// The one setting for where the backend lives. The browser only ever calls this site (/api/*), and
// these rewrites forward it - so the login cookie is first-party and no CORS is involved.
// Read when the app is built (a Docker image is built for one backend address).
const BACKEND_URL = (
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_URL ||          // older names, still honoured
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000"
).replace(/\/+$/, "");

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
  // The /api rewrite below is a proxy, and Next gives up on a proxied request after 30 s (answering an empty 500).
  // Summoning a boss makes two LLM calls in one request, which can take longer than that on a slow provider.
  experimental: { proxyTimeout: 180_000 },
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
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
    ];
  },
};

export default nextConfig;
