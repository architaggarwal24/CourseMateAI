// The site's one canonical address and its search/social metadata (SEO audit, P0).
//
// NEXT_PUBLIC_SITE_URL is the address people should see in search results and link previews, e.g.
// https://coursemateai.architaggarwal.workers.dev. It is read when the app is BUILT (Next inlines NEXT_PUBLIC_*), so
// set it wherever `next build` / `opennextjs-cloudflare build` runs (the deploy job in .github/workflows/ci.yml, a
// local .env.production). A production build without a valid https address fails (next.config.ts): a wrong or
// localhost canonical can never ship. Only `next dev` and the tests fall back to localhost.
import type { Metadata } from "next";
import { parseSiteUrl } from "./site-url";
import { FEATURE_PAGES, FEATURES_HUB, featurePath } from "./landing/features";
import { TOOL_PAGES, TOOLS_HUB, toolPath } from "./landing/tools";
import { chapterPublicPages } from "./content/chapters";
import { CHAPTER_SETS } from "./content/sets";

export { parseSiteUrl };

export const SITE_NAME = "CourseMateAI";

/** The canonical origin of this build. */
export function siteOrigin(): URL {
  return parseSiteUrl(process.env.NEXT_PUBLIC_SITE_URL, process.env.NODE_ENV === "production");
}

/** An absolute URL on the canonical origin. */
export const absoluteUrl = (path: string) => new URL(path, siteOrigin()).toString();

// ── The public pages ──────────────────────────────────────────────────────────────────────────────────────────
// The ONLY pages that may be indexed and listed in the sitemap. Everything else (the app: /today, /study, /hero,
// /account; /login; /offline; the API) is private or a utility page and carries noindex. Add a page here only when
// it is public, returns 200 without signing in, and has real content of its own.
export interface PublicPage { path: string; title: string; description: string; lastModified?: string }
export const LEGAL_UPDATED_ISO = "2026-11-14";     // src/app/legal/legal.ts UPDATED ("14 November 2026"), lib/legal.ts TERMS_VERSION
/** When the landing page's content last really changed (the sitemap's lastmod). Move it when the page's words change. */
export const LANDING_UPDATED_ISO = "2026-11-14";
export const PUBLIC_PAGES: readonly PublicPage[] = [
  {
    path: "/",
    title: "CourseMateAI: your PDFs, turned into a tutor",
    description: "Upload your course notes: a tutor that cites the page, quizzes and flashcards from your own material, spaced-repetition review and a hero that levels up.",
    lastModified: LANDING_UPDATED_ISO,
  },
  { path: FEATURES_HUB.path, title: FEATURES_HUB.title, description: FEATURES_HUB.description, lastModified: FEATURES_HUB.updated },
  ...FEATURE_PAGES.map((f) => ({ path: featurePath(f.slug), title: f.title, description: f.description, lastModified: f.updated })),
  { path: TOOLS_HUB.path, title: TOOLS_HUB.title, description: TOOLS_HUB.description, lastModified: TOOLS_HUB.updated },
  ...TOOL_PAGES.map((t) => ({ path: toolPath(t.slug), title: t.title, description: t.description, lastModified: t.updated })),
  // chapter pages: only once a person has checked them (src/lib/content/chapters.ts, the review rule)
  ...chapterPublicPages(CHAPTER_SETS),
  {
    path: "/legal/terms",
    title: "Terms of Service",
    description: "The terms for using CourseMateAI: your account, your documents, fair use, plans and payments, and how the service may change.",
    lastModified: LEGAL_UPDATED_ISO,
  },
  {
    path: "/legal/privacy",
    title: "Privacy Policy",
    description: "What CourseMateAI collects (account, documents, study data, usage, payment status), who processes it, how long it is kept and your choices.",
    lastModified: LEGAL_UPDATED_ISO,
  },
  {
    path: "/legal/refunds",
    title: "Cancellation & Refund Policy",
    description: "How cancelling a CourseMateAI subscription works and when a payment can be refunded.",
    lastModified: LEGAL_UPDATED_ISO,
  },
];

export function publicPage(path: string): PublicPage {
  const p = PUBLIC_PAGES.find((x) => x.path === path);
  if (!p) throw new Error(`${path} is not a public page (src/lib/site.ts PUBLIC_PAGES)`);
  return p;
}

/** The social image (src/app/opengraph-image.png, served at /opengraph-image.png): 1200 x 630, for Open Graph and Twitter. */
export const SHARE_IMAGE = { url: "/opengraph-image.png", width: 1200, height: 630, alt: "CourseMateAI: your PDFs as a study companion" };

/**
 * A public page's metadata: its own title and description, a canonical URL on the canonical origin, and Open Graph
 * and Twitter tags. (Metadata merges shallowly, so each page sets the whole openGraph / twitter objects.)
 */
export function pageMetadata(path: string, opts: { absoluteTitle?: boolean } = {}): Metadata {
  const p = publicPage(path);
  const fullTitle = opts.absoluteTitle ? p.title : `${p.title} | ${SITE_NAME}`;
  return {
    title: opts.absoluteTitle ? { absolute: p.title } : p.title,
    description: p.description,
    alternates: { canonical: p.path },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website", siteName: SITE_NAME, locale: "en_IN", url: p.path, title: fullTitle, description: p.description,
      images: [SHARE_IMAGE],
    },
    twitter: { card: "summary_large_image", title: fullTitle, description: p.description, images: [SHARE_IMAGE.url] },
  };
}

/** Private and utility pages: never indexed (the meta tag; next.config.ts also sends X-Robots-Tag). */
export const NOINDEX: Metadata["robots"] = { index: false, follow: false, googleBot: { index: false, follow: false } };

// ── Structured data ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * Organization + WebSite + WebApplication JSON-LD for the homepage: only facts that are true and visible (the name,
 * the address, the logo, what the app is, and the plans' prices, from the same list the page shows). No ratings,
 * reviews or user counts until there are real ones (Google's review rules), and no Course entities (courses are each
 * student's private folders). Without the plans, the app carries no offers rather than made-up ones.
 */
export function siteJsonLd(plans?: readonly { price_month: number }[]) {
  const url = siteOrigin().toString();
  const prices = (plans ?? []).map((p) => p.price_month);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${url}#organization`, name: SITE_NAME, url, logo: absoluteUrl("/icons/icon-512.png") },
      { "@type": "WebSite", "@id": `${url}#website`, name: SITE_NAME, alternateName: ["CourseMate AI"], url, inLanguage: "en", publisher: { "@id": `${url}#organization` } },
      {
        "@type": "WebApplication", "@id": `${url}#app`, name: SITE_NAME, url, description: publicPage("/").description,
        applicationCategory: "EducationalApplication", operatingSystem: "Any (runs in the browser; installable on Android and iPhone)",
        browserRequirements: "A current web browser", inLanguage: "en", isAccessibleForFree: true, image: absoluteUrl(SHARE_IMAGE.url),
        publisher: { "@id": `${url}#organization` },
        ...(prices.length ? { offers: { "@type": "AggregateOffer", priceCurrency: "INR", lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: prices.length } } : {}),
      },
    ],
  };
}

/** JSON for a <script type="application/ld+json">: "<" escaped so the data can never close the tag. */
export const jsonLdScript = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
