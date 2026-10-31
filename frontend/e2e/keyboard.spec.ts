import { test, expect, type Page } from "@playwright/test";
import { PAGES } from "./pages";
import { openPage } from "./helpers";

/** What the focused element looks like: does it show a ring (outline or shadow)? */
async function focusIndicator(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
    const shadow = s.boxShadow !== "none" && s.boxShadow !== "";
    const label = (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30);
    return { tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 50), label, visible: outline || shadow };
  });
}

test.describe("keyboard", () => {
  test("the first Tab stop is the skip link; using it moves focus into the main content", async ({ page }) => {
    await openPage(page, PAGES.find((p) => p.name === "study: chat")!);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    expect(await skip.boundingBox()).not.toBeNull();
    const top = await skip.evaluate((el) => el.getBoundingClientRect().top);
    expect(top, "skip link is on screen when focused").toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#main-content")), "next Tab is inside main").toBe(true);
  });

  test("the login page has a main landmark for the skip link too", async ({ page }) => {
    await openPage(page, PAGES.find((p) => p.name === "login")!);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(page.getByRole("main")).toHaveCount(1);
  });

  for (const c of PAGES) {
    test(`every Tab stop shows a focus ring, in a sensible order: ${c.name}`, async ({ page }) => {
      await openPage(page, c);

      const positive = await page.evaluate(() => Array.from(document.querySelectorAll("[tabindex]")).filter((e) => Number(e.getAttribute("tabindex")) > 0).length);
      expect(positive, "positive tabindex scrambles the tab order").toBe(0);

      const seen: string[] = [];
      let sawMain = false, navAfterMain = false;
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        await page.waitForTimeout(220);                       // a ring that is faded in by `transition: all` is measured once it has arrived
        const f = await focusIndicator(page);
        if (!f) break;
        const region = await page.evaluate(() => {
          const el = document.activeElement!;
          return el.closest("main") ? "main" : el.closest("nav, aside") ? "nav" : "other";
        });
        if (region === "main") sawMain = true;
        if (region === "nav" && sawMain) navAfterMain = true;
        if (!f.visible) seen.push(`<${f.tag} class="${f.cls}"> "${f.label}"`);
      }
      expect(seen.join("\n"), "focused with no visible ring").toBe("");
      // The sidebar / bottom bar is in the page before (desktop) or after (mobile) the screen; never both sides of it.
      expect(navAfterMain && sawMain && (await page.viewportSize())!.width >= 768, "desktop nav comes before the content").toBe(false);
    });
  }
});
