// IndexNow (the SEO pass): after a deploy, tell Bing, and the engines that share with it, which public pages exist,
// instead of waiting for a crawl. Run by the deploy job (.github/workflows/ci.yml) after the Worker is live:
//   NEXT_PUBLIC_SITE_URL=https://your.site node scripts/indexnow.mjs
// It reads the live sitemap (so it only ever sends public pages), and proves the site is ours with the key file in
// public/<key>.txt (public by design). A failure is printed and the script still exits 0: a deploy never fails over it.
// https://www.indexnow.org/documentation
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://api.indexnow.org/indexnow";

/** The key: the one public/<32 hex>.txt file, whose content is its own name. */
export function findKey(publicDir) {
  const files = readdirSync(publicDir).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  if (files.length !== 1) throw new Error(`expected one IndexNow key file in ${publicDir}, found ${files.length}`);
  const key = files[0].slice(0, 32);
  if (readFileSync(join(publicDir, files[0]), "utf8").trim() !== key) throw new Error(`${files[0]} must contain just its key`);
  return key;
}

/** Every <loc> in a sitemap. */
export const parseSitemap = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);

/** The POST body: only URLs on the site's own host (the protocol rejects others anyway). */
export function indexNowBody(site, key, urls) {
  const origin = new URL(site);
  return {
    host: origin.host, key, keyLocation: new URL(`/${key}.txt`, origin).toString(),
    urlList: urls.filter((u) => { try { return new URL(u).host === origin.host; } catch { return false; } }),
  };
}

/** Read the sitemap and send it. Never throws: returns what happened. */
export async function submit({ site, key, fetcher = fetch }) {
  try {
    const res = await fetcher(new URL("/sitemap.xml", site).toString());
    if (!res.ok) return { ok: false, reason: `sitemap answered ${res.status}` };
    const body = indexNowBody(site, key, parseSitemap(await res.text()));
    if (!body.urlList.length) return { ok: false, reason: "the sitemap lists no pages" };
    const sent = await fetcher(ENDPOINT, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) });
    // 200 received, 202 received (key check pending); anything else is a refusal
    return { ok: sent.status === 200 || sent.status === 202, status: sent.status, count: body.urlList.length };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) { console.log("IndexNow: NEXT_PUBLIC_SITE_URL is not set, skipped"); process.exit(0); }
  const key = findKey(join(fileURLToPath(new URL(".", import.meta.url)), "..", "public"));
  const r = await submit({ site, key });
  console.log(r.ok ? `IndexNow: sent ${r.count} pages (${r.status})` : `IndexNow: not sent (${r.reason ?? `answered ${r.status}`})`);
}
