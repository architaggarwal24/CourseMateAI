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
