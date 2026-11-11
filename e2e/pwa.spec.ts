import { test, expect } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// Phase 3 Stage 4d: the installable app and the page security headers (production build).

test.use({ serviceWorkers: "allow" });

test("the app is installable and polite offline", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "once is enough");
  await mockApi(page);
  const res = await page.goto("/study?tab=chat&doc=doc-1");
  const h = res!.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");

  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ short_name: "CourseMateAI", start_url: "/today", display: "standalone" });
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");
  expect((await page.request.get("/icons/icon-512.png")).status()).toBe(200);
  const sw = await page.request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-store");

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();                                               // now controlled by the worker
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForFunction(async () => !!(await caches.match("/offline")));
  await context.setOffline(true);
  await page.goto("/quests").catch(() => {});
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible({ timeout: 30_000 });   // the worker can be slow under load
  await context.setOffline(false);
});
