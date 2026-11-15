/** @vitest-environment node */
// IndexNow (the SEO pass): after a deploy, tell Bing and the engines that share with it which public pages exist or
// changed, instead of waiting for them to crawl. The key is public by design: it's served as /<key>.txt to prove the
// site is ours.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findKey, indexNowBody, parseSitemap, submit } from "../../scripts/indexnow.mjs";

const PUBLIC = join(__dirname, "..", "..", "public");

describe("IndexNow", () => {
  it("has exactly one key file in public/, named by the key and holding only the key", () => {
    const files = readdirSync(PUBLIC).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(PUBLIC, files[0]), "utf8")).toBe(files[0].slice(0, 32));
    expect(findKey(PUBLIC)).toBe(files[0].slice(0, 32));
  });

  it("reads the page addresses out of the sitemap", () => {
    const xml = `<?xml version="1.0"?><urlset><url><loc>https://a.example/</loc><lastmod>2026-11-14</lastmod></url><url><loc>https://a.example/features</loc></url></urlset>`;
    expect(parseSitemap(xml)).toEqual(["https://a.example/", "https://a.example/features"]);
  });

  it("sends the host, the key, where the key file is and the URLs; only URLs on that host", () => {
    expect(indexNowBody("https://a.example", "k".repeat(32), ["https://a.example/", "https://evil.example/x"])).toEqual({
      host: "a.example", key: "k".repeat(32), keyLocation: `https://a.example/${"k".repeat(32)}.txt`, urlList: ["https://a.example/"],
    });
  });

  it("posts once to the shared endpoint; a refusal is reported, never thrown (a deploy must not fail over it)", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(`<urlset><url><loc>https://a.example/</loc></url></urlset>`))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    expect(await submit({ site: "https://a.example", key: "a".repeat(32), fetcher })).toMatchObject({ ok: true, status: 202, count: 1 });
    expect(fetcher.mock.calls[0][0]).toBe("https://a.example/sitemap.xml");
    expect(fetcher.mock.calls[1][0]).toBe("https://api.indexnow.org/indexnow");
    expect(JSON.parse(fetcher.mock.calls[1][1].body).urlList).toEqual(["https://a.example/"]);
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await submit({ site: "https://a.example", key: "a".repeat(32), fetcher: failing })).toMatchObject({ ok: false });
  });
});
