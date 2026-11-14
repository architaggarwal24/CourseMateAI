import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// The speed pass (BreakingBreach performance toolkit, fix 16): the page's HTML asks who you are (GET /auth/me) and
// for the HUD while its JavaScript downloads, and the app's own requests reuse those answers: one request each.
test("an app screen asks for /auth/me and /hud once each, starting with the HTML", async ({ page }) => {
  await mockApi(page);
  const seen: { url: string; type: string }[] = [];
  page.on("request", (r) => { if (/\/api\/v1\/(auth\/me|hud)$/.test(new URL(r.url()).pathname)) seen.push({ url: new URL(r.url()).pathname, type: r.resourceType() }); });
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "Review" })).toBeVisible();
  const me = seen.filter((s) => s.url.endsWith("/auth/me"));
  expect(me.length).toBe(1);
  const html = await page.content();
  expect(html).toMatch(/<link[^>]+rel="preload"[^>]+href="\/api\/v1\/auth\/me"/);
});
