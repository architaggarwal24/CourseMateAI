/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROD = "https://coursemateai.architaggarwal.workers.dev";
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", PROD));
afterEach(() => vi.unstubAllEnvs());

describe("sitemap.xml", () => {
  it("lists exactly the public pages, on the canonical origin", async () => {
    const { default: sitemap } = await import("./sitemap");
    const entries = sitemap();
    expect(entries.map((e) => e.url)).toEqual(["/", "/features", "/features/ai-tutor", "/features/quizzes-flashcards-exams", "/features/spaced-repetition", "/features/study-game", "/legal/terms", "/legal/privacy", "/legal/refunds"].map((p) => `${PROD}${p === "/" ? "/" : p}`));
    expect(entries[0].lastModified).toBeUndefined();                     // not known: not invented
    expect(entries.find((e) => e.url.endsWith("/legal/terms"))!.lastModified).toBe("2026-11-05");
    for (const e of entries) expect(new URL(e.url).pathname).not.toMatch(/^\/(today|study|hero|account|login|offline|api)(\/|$)/);
  });
});

describe("robots.txt", () => {
  it("allows crawling, skips only the API, and points at the sitemap", async () => {
    const { default: robots } = await import("./robots");
    expect(robots()).toEqual({ rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }], sitemap: `${PROD}/sitemap.xml` });
  });
});

describe("page metadata", () => {
  it("public pages have unique titles and their own canonical; private pages are noindex", async () => {
    const pages = await Promise.all([
      import("./legal/terms/page"), import("./legal/privacy/page"), import("./legal/refunds/page"),
    ]);
    const canon = pages.map((p) => (p.metadata.alternates as { canonical: string }).canonical);
    expect(canon).toEqual(["/legal/terms", "/legal/privacy", "/legal/refunds"]);
    expect(new Set(pages.map((p) => String(p.metadata.title))).size).toBe(3);
    const login = await import("./login/layout"), offline = await import("./offline/page"), app = await import("./(app)/layout");
    for (const m of [login.metadata, offline.metadata, app.metadata]) expect(m.robots).toMatchObject({ index: false, follow: false });
  });

  it("the root layout sets the canonical origin and default social tags, and no site-wide canonical", async () => {
    vi.resetModules();
    const { metadata } = await import("./layout");
    expect(String(metadata.metadataBase)).toBe(`${PROD}/`);
    expect(metadata.alternates).toBeUndefined();                          // each public page sets its own
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    expect(metadata.description).not.toMatch(/gamification$/);
  });
});
