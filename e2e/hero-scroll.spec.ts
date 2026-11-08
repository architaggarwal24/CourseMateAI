import { test, expect } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// Opening /hero directly (no Study page first) must still give every tab a bounded panel that scrolls.
for (const tab of ["quests", "arena", "bestiary", "shop", "inventory", "champion", "achievements"]) {
  test(`hero: ${tab} scrolls inside its panel`, async ({ page }) => {
    await mockApi(page);
    await page.goto(`/hero?tab=${tab}`);
    const panel = page.locator(`[data-hero-tab="${tab}"]`);
    await expect(panel).toBeVisible();
    const box = await panel.evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight, vh: window.innerHeight, ov: getComputedStyle(el).overflowY }));
    expect(box.ov).toBe("auto");
    expect(box.h).toBeLessThanOrEqual(box.vh);                                     // bounded by the screen
    // and it really scrolls (polled: the tab's content may still be arriving, and the panel grows with it)
    await expect.poll(() => panel.evaluate((el) => { if (el.scrollHeight <= el.clientHeight + 4) return 1; el.scrollTop = 200; return el.scrollTop; })).toBeGreaterThan(0);
  });
}
