import { test, expect } from "@playwright/test";
import { PAGES } from "./pages";
import { openPage } from "./helpers";

// prefers-reduced-motion: Hero and the arena stop animating. (Loading spinners keep turning: they carry information.)
const HERO = PAGES.filter((p) => p.name.startsWith("hero"));

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  for (const c of HERO) {
    test(`no ambient animation: ${c.name}`, async ({ page }) => {
      await openPage(page, c);
      const running = await page.evaluate(() =>
        document.getAnimations()
          .filter((a) => a.playState === "running")
          .filter((a) => {
            const timing = a.effect?.getComputedTiming();
            const el = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
            const spinner = !!el?.closest(".animate-spin, .ui-spinner, .loading-dot, .av-spinner");
            return !spinner && (timing?.iterations === Infinity || (timing?.duration as number) > 50);
          })
          .map((a) => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "animation"} on ${((a.effect as KeyframeEffect).target as HTMLElement)?.className}`),
      );
      expect(running.join("\n"), "animations still running").toBe("");
    });
  }

  test("the same Hero screen does animate when motion is not reduced", async ({ page, browser }) => {
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    const p = await context.newPage();
    await openPage(p, PAGES.find((x) => x.name === "hero: forge")!);
    const infinite = await p.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length);
    expect(infinite, "the check above would be meaningless if nothing ever animated").toBeGreaterThan(0);
    await context.close();
  });
});
