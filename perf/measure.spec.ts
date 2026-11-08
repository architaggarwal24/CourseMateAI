// Performance measurement (not a pass/fail test): opens every screen against the production build with the API
// mocked, and records what the browser downloaded and how fast it got there. Run it before and after a change:
//
//   npm run build
//   npx playwright test -c playwright.perf.config.ts            (writes perf/results/<label>.json)
//   PERF_LABEL=after npx playwright test -c playwright.perf.config.ts
//   PERF_THROTTLE=1 ...                                          (4x slower CPU and a "fast 3G" network)
//
// Numbers are from one machine and one run; compare runs on the same machine, not across machines.
import { test, type Page, type CDPSession } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { mockApi } from "../e2e/fixtures/api";
import { PAGES } from "../e2e/pages";

interface Row {
  name: string; path: string;
  /** JS fetched before the screen was ready (what the user waited for); jsKB adds what loads after (idle prefetch). */
  jsReadyKB: number;
  jsKB: number; cssKB: number; fontKB: number; requests: number;
  apiCalls: number; duplicateApi: string[];
  readyMs: number; lcpMs: number | null; cls: number;
}

const rows: Row[] = [];
const throttle = process.env.PERF_THROTTLE === "1";
const label = process.env.PERF_LABEL ?? (throttle ? "throttled" : "baseline");

async function slowDown(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  // Chrome DevTools' "Fast 3G" preset (with the 4x CPU slowdown Lighthouse uses for a mid-range phone).
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 563, downloadThroughput: (1.44 * 1024 * 1024) / 8, uploadThroughput: (675 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return cdp;
}

for (const c of PAGES.filter((p) => !p.before)) {
  test(c.name, async ({ page }) => {
    test.setTimeout(120_000);
    if (throttle) await slowDown(page);
    await mockApi(page, { signedIn: c.auth });
    const api: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && r.method() === "GET") api.push(u.pathname + u.search);
    });
    await page.addInitScript(() => {
      const w = window as unknown as { __lcp: number | null; __cls: number };
      w.__lcp = null; w.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    const t0 = Date.now();
    await page.goto(c.path);
    await page.locator(c.ready).first().waitFor({ state: "visible", timeout: 90_000 });
    const readyMs = Date.now() - t0;
    const readyAt = await page.evaluate(() => performance.now());
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const res = await page.evaluate((readyAt) => {
      const w = window as unknown as { __lcp: number | null; __cls: number };
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const sum = (re: RegExp) => entries.filter((e) => re.test(new URL(e.name).pathname)).reduce((a, e) => a + (e.encodedBodySize || 0), 0);
      const jsReady = entries.filter((e) => /\.js$/.test(new URL(e.name).pathname) && e.startTime <= readyAt).reduce((a, e) => a + (e.encodedBodySize || 0), 0);
      return { js: sum(/\.js$/), jsReady, css: sum(/\.css$/), font: sum(/\.(woff2?|ttf)$/), requests: entries.length, lcp: w.__lcp, cls: w.__cls };
    }, readyAt);
    const counts = new Map<string, number>();
    for (const a of api) counts.set(a, (counts.get(a) ?? 0) + 1);
    rows.push({
      name: c.name, path: c.path,
      jsReadyKB: Math.round(res.jsReady / 102.4) / 10, jsKB: Math.round(res.js / 102.4) / 10, cssKB: Math.round(res.css / 102.4) / 10, fontKB: Math.round(res.font / 102.4) / 10,
      requests: res.requests, apiCalls: api.length, duplicateApi: [...counts].filter(([, n]) => n > 1).map(([p, n]) => `${p} x${n}`),
      readyMs, lcpMs: res.lcp === null ? null : Math.round(res.lcp), cls: Math.round(res.cls * 1000) / 1000,
    });
  });
}

test.afterAll(() => {
  const dir = path.join(__dirname, "results");
  fs.mkdirSync(dir, { recursive: true });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(dir, `${label}.json`), JSON.stringify(rows, null, 2));
  console.table(rows.map(({ duplicateApi, path: _p, ...r }) => ({ ...r, dup: duplicateApi.join(" ") })));
});
