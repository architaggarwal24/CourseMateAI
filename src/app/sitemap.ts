import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, absoluteUrl } from "@/lib/site";

// Only the allowlisted public pages (src/lib/site.ts PUBLIC_PAGES), on the canonical origin - never the app, the
// login page, the API or anything user-specific. lastModified only where it is really known (the policies' date).
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((p) => ({
    url: absoluteUrl(p.path),
    ...(p.lastModified ? { lastModified: p.lastModified } : {}),
  }));
}
