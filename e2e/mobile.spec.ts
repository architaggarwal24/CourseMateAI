import { test, expect } from "@playwright/test";
import { PAGES } from "./pages";
import { openPage } from "./helpers";

// 360px wide, touch: every screen fits without sideways scrolling and every control can be hit with a finger.
test.describe("360px", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "mobile-360", "phone-width checks"); });

  for (const c of PAGES) {
    test(`fits and is tappable: ${c.name}`, async ({ page }) => {
      await openPage(page, c);

      const width = await page.evaluate(() => ({
        viewport: window.innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth,
      }));
      expect(width.viewport).toBe(360);
      expect(width.doc, "page scrolls sideways").toBeLessThanOrEqual(360);
      expect(width.body, "body scrolls sideways").toBeLessThanOrEqual(360);

      const tooSmall = await page.evaluate(() => {
        const selector = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch], [tabindex]:not([tabindex="-1"])';
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0 || style.visibility === "hidden" || style.display === "none") continue;
          if (el.closest("[aria-hidden='true']") || el.classList.contains("skip-link")) continue;
          if (style.display === "inline" && el.tagName === "A") continue;                // a link inside a sentence
          if (el.tagName === "DIV" && el.scrollHeight > el.clientHeight) continue;         // a focusable scroll region, not a control
          // A checkbox / switch / radio is hit through its label: the label counts.
          const hit = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") && el.labels?.[0] ? el.labels[0].getBoundingClientRect() : box;
          if (hit.width < 44 - 0.5 || hit.height < 44 - 0.5) {
            out.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 60)}"> ${Math.round(hit.width)}x${Math.round(hit.height)} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}"`);
          }
        }
        return out;
      });
      expect(tooSmall.join("\n"), "controls smaller than 44x44px").toBe("");
    });
  }
});

// The mobile pass: on a phone the screen goes to the content, not to chrome.
test.describe("360px: room for the content", () => {
  test.beforeEach(({}, info) => { test.skip(info.project.name !== "mobile-360", "phone-width checks"); });

  test("Today opens on the day's work: Review is on the first screen, above the Hero world's news", async ({ page }) => {
    await openPage(page, PAGES.find((p) => p.name === "today")!);
    const review = (await page.getByRole("region", { name: "Review" }).boundingBox())!;
    expect(review.y).toBeLessThan(260);
    const news = page.getByText(/Something stirs in the Hero world/);
    if (await news.count()) expect((await news.boundingBox())!.y).toBeGreaterThan(review.y);
  });

  test("Study: the document bar and the tool tabs take a slim band; the tabs still name their groups for screen readers", async ({ page }) => {
    await openPage(page, PAGES.find((p) => p.name === "study: chat")!);
    const tabs = (await page.getByRole("navigation", { name: "Study tools" }).boundingBox())!;
    expect(tabs.y + tabs.height).toBeLessThanOrEqual(140);
    await expect(page.getByRole("group", { name: "Practice" })).toBeAttached();
  });

  test("Hero: a slim header with a menu (no Esc on a phone), readable tab labels, compact arena modes", async ({ page }) => {
    await openPage(page, PAGES.find((p) => p.name === "play: arena")!);
    const header = (await page.getByTestId("hero-header").boundingBox())!;
    expect(header.height).toBeLessThanOrEqual(72);
    await page.getByTestId("hero-header").getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("dialog", { name: "Paused" })).toBeVisible();
    await page.getByRole("button", { name: "Resume" }).click();
    const label = await page.locator(".bottom__link").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(label).toBeGreaterThanOrEqual(11);
    const quick = (await page.getByRole("button", { name: /Quick Battle/ }).boundingBox())!;
    expect(quick.height).toBeLessThanOrEqual(130);                                     // a row, not a poster
  });
});
