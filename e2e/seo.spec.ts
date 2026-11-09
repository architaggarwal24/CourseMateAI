import { test, expect, type APIRequestContext } from "@playwright/test";

// SEO P0 (src/lib/site.ts): what crawlers and link previews get from the production build, read from the raw HTML
// (no JavaScript), so it doesn't depend on hydration.
const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://coursemateai.architaggarwal.workers.dev";
const PUBLIC = [
  { path: "/", title: "CourseMateAI: your PDFs, turned into a tutor", h1: /turned into a/ },
  { path: "/features", title: "Features: AI study tools built on your own notes | CourseMateAI", h1: /Study tools built on your own notes/ },
  { path: "/features/ai-tutor", title: "AI tutor for your PDFs: chat, notes and concept maps | CourseMateAI", h1: /An AI tutor that has read your course notes/ },
  { path: "/features/quizzes-flashcards-exams", title: "Quizzes, flashcards and mock exams from your notes | CourseMateAI", h1: /Practice questions written from your own notes/ },
  { path: "/features/spaced-repetition", title: "Spaced-repetition review for what you study | CourseMateAI", h1: /A daily review that brings cards back/ },
  { path: "/features/study-game", title: "A study game: boss fights built from your notes | CourseMateAI", h1: /Boss fights where every question/ },
  { path: "/legal/terms", title: "Terms of Service | CourseMateAI", h1: /Terms of Service/ },
  { path: "/legal/privacy", title: "Privacy Policy | CourseMateAI", h1: /Privacy Policy/ },
  { path: "/legal/refunds", title: "Cancellation & Refund Policy | CourseMateAI", h1: /Cancellation/ },
];
const PRIVATE = ["/today", "/study", "/study?tab=notes", "/hero", "/account", "/account/settings", "/login", "/login?mode=register", "/offline"];

test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => { test.skip(info.project.name !== "desktop", "server output: one project is enough"); });

async function html(request: APIRequestContext, path: string) {
  const res = await request.get(path, { maxRedirects: 0 });
  return { res, body: await res.text() };
}
const meta = (body: string, attr: "name" | "property", key: string) =>
  [...body.matchAll(new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, "\\$&")}" content="([^"]*)"`, "g"))].map((m) => m[1].replace(/&amp;/g, "&"));
const link = (body: string, rel: string) => [...body.matchAll(new RegExp(`<link rel="${rel}" href="([^"]*)"`, "g"))].map((m) => m[1]);

for (const p of PUBLIC) {
  test(`public ${p.path}: 200, its own title, description, canonical, social tags, one H1, indexable`, async ({ request }) => {
    const { res, body } = await html(request, p.path);
    expect(res.status()).toBe(200);
    expect(res.headers()["x-robots-tag"]).toBeUndefined();
    expect(body).toContain(`<title>${p.title.replace(/&/g, "&amp;")}</title>`);
    expect(meta(body, "name", "description")).toHaveLength(1);
    expect(link(body, "canonical")).toEqual([p.path === "/" ? ORIGIN : `${ORIGIN}${p.path}`]);
    expect(meta(body, "name", "robots").join()).not.toMatch(/noindex/);
    expect(meta(body, "property", "og:url")).toEqual([p.path === "/" ? ORIGIN : `${ORIGIN}${p.path}`]);
    expect(meta(body, "property", "og:title")).toHaveLength(1);
    expect(meta(body, "property", "og:image")[0]).toBe(`${ORIGIN}/opengraph-image.png`);
    expect(meta(body, "property", "og:image:width")).toEqual(["1200"]);
    expect(meta(body, "name", "twitter:card")).toEqual(["summary_large_image"]);
    expect(meta(body, "name", "twitter:image")[0]).toMatch(new RegExp(`^${ORIGIN}/`));
    expect((body.match(/<h1[\s>]/g) ?? []).length).toBe(1);
    expect(body.replace(/<[^>]+>/g, "")).toMatch(p.h1);
    expect(body).not.toMatch(/localhost|127\.0\.0\.1/);
  });
}

test("titles and descriptions are unique across the public pages", async ({ request }) => {
  const pages = await Promise.all(PUBLIC.map((p) => html(request, p.path)));
  const descriptions = pages.map(({ body }) => meta(body, "name", "description")[0]);
  expect(new Set(descriptions).size).toBe(PUBLIC.length);
});

test("feature pages carry a BreadcrumbList that matches their visible breadcrumb", async ({ request }) => {
  const { body } = await html(request, "/features/spaced-repetition");
  const ld = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  expect(ld).toHaveLength(1);
  expect(ld[0]["@type"]).toBe("BreadcrumbList");
  expect(ld[0].itemListElement.map((i: { name: string; item: string }) => [i.name, i.item])).toEqual([
    ["CourseMateAI", `${ORIGIN}/`], ["Features", `${ORIGIN}/features`], ["Spaced-repetition review", `${ORIGIN}/features/spaced-repetition`]]);
  expect(body).toContain('aria-label="Breadcrumb"');
});

test("the homepage's JSON-LD parses and claims only Organization and WebSite on the canonical origin", async ({ request }) => {
  const { body } = await html(request, "/");
  const blocks = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  expect(blocks).toHaveLength(1);
  expect(blocks[0]["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["Organization", "WebSite"]);
  expect(blocks[0]["@graph"][0]).toMatchObject({ name: "CourseMateAI", url: `${ORIGIN}/` });
  expect(JSON.stringify(blocks[0])).not.toMatch(/Rating|review|offers|price/i);
});

for (const path of PRIVATE) {
  test(`private ${path}: noindex in the page and the header`, async ({ request }) => {
    const { res, body } = await html(request, path);
    expect(res.status()).toBe(200);
    expect(res.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(meta(body, "name", "robots").join()).toMatch(/noindex/);
    expect(link(body, "canonical")).toEqual([]);
  });
}

test("the API answers noindex too", async ({ request }) => {
  const res = await request.get("/api/v1/plans");
  expect(res.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

test("robots.txt and sitemap.xml: 200, the allowlist only, the canonical origin", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  const txt = await robots.text();
  expect(txt).toMatch(/User-Agent: \*/);
  expect(txt).toMatch(/Allow: \//);
  expect(txt).toMatch(/Disallow: \/api\//);
  expect(txt).not.toMatch(/Disallow: \/(study|account|today|hero)/);       // they must stay crawlable to read noindex
  expect(txt).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);

  const map = await request.get("/sitemap.xml");
  expect(map.status()).toBe(200);
  expect(map.headers()["content-type"]).toMatch(/xml/);
  const urls = [...(await map.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(urls).toEqual(PUBLIC.map((p) => (p.path === "/" ? `${ORIGIN}/` : `${ORIGIN}${p.path}`)));
});

test("the share image is served", async ({ request }) => {
  for (const path of ["/opengraph-image.png"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
});

test("an unknown page (or feature) is a 404 and not indexable", async ({ request }) => {
  expect((await request.get("/features/no-such-feature")).status()).toBe(404);
  const { res, body } = await html(request, "/no-such-page");
  expect(res.status()).toBe(404);
  expect(meta(body, "name", "robots").join()).toMatch(/noindex/);
});
