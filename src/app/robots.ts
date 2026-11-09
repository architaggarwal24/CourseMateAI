import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

// robots.txt guides crawling; it is not a privacy control (the app pages are protected by sign-in and carry noindex,
// which crawlers can only see if they may fetch the page, so those stay allowed). Only the JSON API is skipped:
// it has nothing to index, and every response says noindex too.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
