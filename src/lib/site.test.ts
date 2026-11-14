/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEGAL_UPDATED_ISO, NOINDEX, PUBLIC_PAGES, jsonLdScript, pageMetadata, parseSiteUrl, siteJsonLd } from "./site";
import { UPDATED } from "@/app/legal/legal";

const PROD = "https://coursemateai.architaggarwal.workers.dev";
afterEach(() => vi.unstubAllEnvs());

describe("the canonical origin", () => {
  it("is the https origin given, trimmed of any trailing slash", () => {
    expect(parseSiteUrl(PROD, true).toString()).toBe(`${PROD}/`);
    expect(parseSiteUrl(`${PROD}/`, true).origin).toBe(PROD);
  });

  it("refuses to build for production without a valid public https address", () => {
    expect(() => parseSiteUrl(undefined, true)).toThrow(/must be set/);
    expect(() => parseSiteUrl("  ", true)).toThrow(/must be set/);
    expect(() => parseSiteUrl("http://localhost:3000", true)).toThrow(/local/);
    expect(() => parseSiteUrl("https://127.0.0.1", true)).toThrow(/local/);
    expect(() => parseSiteUrl("http://coursemateai.example.com", true)).toThrow(/https/);
    expect(() => parseSiteUrl(`${PROD}/app`, true)).toThrow(/just the origin/);
    expect(() => parseSiteUrl(`${PROD}?x=1`, true)).toThrow(/just the origin/);
    expect(() => parseSiteUrl("not a url", true)).toThrow(/not a valid URL/);
  });

  it("falls back to localhost only outside production", () => {
    expect(parseSiteUrl(undefined, false).origin).toBe("http://localhost:3000");
    expect(parseSiteUrl("http://localhost:4000", false).origin).toBe("http://localhost:4000");
  });
});

describe("the public pages", () => {
  it("are an explicit allowlist with no private or utility page in it", () => {
    expect(PUBLIC_PAGES.map((p) => p.path)).toEqual(["/", "/features", "/features/ai-tutor", "/features/quizzes-flashcards-exams", "/features/spaced-repetition", "/features/study-game", "/legal/terms", "/legal/privacy", "/legal/refunds"]);
    for (const p of PUBLIC_PAGES) expect(p.path).not.toMatch(/^\/(today|study|hero|account|login|offline|api|dev)(\/|$)/);
  });

  it("each have their own title, description and canonical; the policies' date matches what they show", () => {
    const titles = PUBLIC_PAGES.map((p) => p.title), descriptions = PUBLIC_PAGES.map((p) => p.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const d of descriptions) expect(d.length).toBeGreaterThan(60);
    expect(new Date(`${LEGAL_UPDATED_ISO}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })).toBe(UPDATED);
  });

  it("pageMetadata gives a full set of tags", () => {
    const m = pageMetadata("/legal/privacy");
    expect(m).toMatchObject({
      title: "Privacy Policy", alternates: { canonical: "/legal/privacy" }, robots: { index: true, follow: true },
      openGraph: { url: "/legal/privacy", title: "Privacy Policy | CourseMateAI", siteName: "CourseMateAI", images: [{ url: "/opengraph-image.png", width: 1200, height: 630 }] },
      twitter: { card: "summary_large_image", title: "Privacy Policy | CourseMateAI" },
    });
    expect(pageMetadata("/", { absoluteTitle: true }).title).toEqual({ absolute: "CourseMateAI: your PDFs, turned into a tutor" });
    expect(() => pageMetadata("/study")).toThrow(/not a public page/);
    expect(NOINDEX).toMatchObject({ index: false, follow: false });
  });
});

describe("structured data", () => {
  it("is Organization + WebSite with only verified facts, on the canonical origin", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", PROD);
    const data = siteJsonLd();
    const json = JSON.stringify(data);
    expect(data["@graph"].map((n) => n["@type"])).toEqual(["Organization", "WebSite"]);
    expect(data["@graph"][0]).toMatchObject({ name: "CourseMateAI", url: `${PROD}/`, logo: `${PROD}/icons/icon-512.png` });
    expect(json).not.toMatch(/aggregateRating|review|ratingValue|offers|price|Course"|localhost/i);
    expect(jsonLdScript({ a: "</script><script>" })).not.toContain("</script>");
  });
});

describe("the Terms version", () => {
  it("is the policies' date: changing one without the other would ask nobody, or everyone, by mistake", async () => {
    const { TERMS_VERSION } = await import("./legal");
    const { LEGAL_UPDATED_ISO } = await import("./site");
    expect(TERMS_VERSION).toBe(LEGAL_UPDATED_ISO);
  });
});
