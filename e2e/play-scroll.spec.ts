import { test, expect } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// Opening a play page directly (no Study page first) must still give every page and Champion tab a bounded area
// that scrolls.
// Desktop: the tab's panel scrolls under the fixed header. Phone: the whole Hero area scrolls (the header goes away)
// and the tabs stay pinned at the top.
for (const tab of ["quests", "arena", "bestiary", "shop", "inventory", "champion", "forge", "achievements", "mastery"]) {
  test(`play: ${tab} scrolls`, async ({ page }, info) => {
    await mockApi(page);
    await page.goto(["quests", "arena", "bestiary"].includes(tab) ? `/${tab}` : `/champion?tab=${tab}`);
    const panel = page.locator(`[data-hero-tab="${tab}"]`);
    await expect(panel).toBeVisible();
    const phone = info.project.name.startsWith("mobile");
    const scroller = phone ? page.locator(".ws--page") : panel;
    const box = await scroller.evaluate((el) => ({ h: el.clientHeight, vh: window.innerHeight, ov: getComputedStyle(el).overflowY }));
    expect(box.ov).toBe("auto");
    expect(box.h).toBeLessThanOrEqual(box.vh);                                     // bounded by the screen
    // and it really scrolls (polled: the tab's content may still be arriving, and it grows with it)
    await expect.poll(() => scroller.evaluate((el) => { if (el.scrollHeight <= el.clientHeight + 4) return 1; el.scrollTop = 200; return el.scrollTop; })).toBeGreaterThan(0);
    if (phone && !["quests", "arena", "bestiary"].includes(tab)) {
      // Champion's tabs stay in view once the header has scrolled away, and nothing is wider than the screen
      // (a tab shorter than the header can't scroll the header away: then there is nothing to pin)
      const room = await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollHeight - el.clientHeight; });
      const tabs = await page.getByRole("navigation", { name: "Champion" }).boundingBox();
      expect(tabs!.y).toBeGreaterThanOrEqual(0);
      const pinAt = await page.locator(".hero-tabs-pin").evaluate((el) => (el as HTMLElement).offsetTop);
      if (room > pinAt) expect(tabs!.y).toBeLessThan(80);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    }
  });
}

test("Me scrolls as one page on a phone", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("mobile"), "phones only");
  await mockApi(page);
  await page.goto("/account");
  const scroller = page.locator(".ws--page");
  await expect(page.getByText("Your account").first()).toBeVisible();
  await expect.poll(() => scroller.evaluate((el) => { el.scrollTop = 300; return el.scrollTop; })).toBeGreaterThan(0);
});
