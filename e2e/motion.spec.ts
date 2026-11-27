import { test, expect } from "@playwright/test";
import { PAGES } from "./pages";
import { openPage } from "./helpers";

// prefers-reduced-motion: Hero, the arena and Study stop animating. (Loading spinners keep turning: they carry
// information.) The in-app "Reduce animations" switch does the same, and Study's own motion (redesign Stage 3) only
// plays when it is allowed.
// (the Hero screens are named "play: …"; this once looked for "hero" and so checked nothing)
const HERO = PAGES.filter((p) => p.name.startsWith("play"));
const STUDY = PAGES.filter((p) => /^(today|study: (chat|quiz|course)|account: plan & usage)$/.test(p.name));
const byName = (n: string) => PAGES.find((x) => x.name === n)!;

/** Animations still running on the page, apart from loading indicators (spinners, skeletons, dots). */
const running = (page: import("@playwright/test").Page) => page.evaluate(() =>
  document.getAnimations()
    .filter((a) => a.playState === "running")
    .filter((a) => {
      const timing = a.effect?.getComputedTiming();
      const el = (a.effect as KeyframeEffect | null)?.target as HTMLElement | null;
      const spinner = !!el?.closest(".animate-spin, .ui-spinner, .loading-dot, .av-spinner, .ui-skeleton");
      return !spinner && (timing?.iterations === Infinity || (timing?.duration as number) > 50);
    })
    .map((a) => `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "animation"} on ${((a.effect as KeyframeEffect).target as HTMLElement)?.className}`));

/** Switch Study from Chat to Quiz through the tool tabs, and report what animates on the new tool. */
async function switchTool(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const seen: string[] = ((window as unknown as { __toolMotion: string[] }).__toolMotion = []);
    document.addEventListener("animationstart", (e) => {
      if ((e.target as Element).parentElement?.classList.contains("ws-tools")) seen.push(e.animationName);
    });
  });
  await page.getByRole("link", { name: "Quiz", exact: true }).first().click();
  await page.getByRole("heading", { name: /quiz/i }).first().waitFor();
  await page.waitForTimeout(100);
  return page.evaluate(() => (window as unknown as { __toolMotion: string[] }).__toolMotion);
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  for (const c of [...HERO, ...STUDY]) {
    test(`no ambient animation: ${c.name}`, async ({ page }) => {
      await openPage(page, c);
      const still = await running(page);
      expect(still.join("\n"), "animations still running").toBe("");
    });
  }

  test("the same Hero screen does animate when motion is not reduced", async ({ page, browser }) => {
    const context = await browser.newContext({ reducedMotion: "no-preference" });
    const p = await context.newPage();
    await openPage(p, PAGES.find((x) => x.name === "play: champion")!);
    const infinite = await p.evaluate(() => document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations === Infinity).length);
    expect(infinite, "the check above would be meaningless if nothing ever animated").toBeGreaterThan(0);
    await context.close();
  });
});

test.describe("Study motion (redesign Stage 3)", () => {
  test("a tool you switch to arrives with the reveal; the tool a visit opens on paints at once", async ({ page }) => {
    await openPage(page, byName("study: chat"));
    expect(await page.evaluate(() => document.querySelector(".ws-tools")?.hasAttribute("data-enter"))).toBe(false);
    const names = await switchTool(page);
    expect(names).toContain("motion-reveal");
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("the motion tokens are zero and switching tools moves nothing", async ({ page }) => {
      await openPage(page, byName("study: chat"));
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--motion-base").trim())).toMatch(/^0?\.01ms$/);
      await switchTool(page);
      await page.waitForTimeout(50);
      expect((await running(page)).join("\n")).toBe("");
    });
  });

  test("the in-app Reduce animations switch stills Study the same way, without the OS setting", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("cmai_appearance", JSON.stringify({ reduceAnimations: true })));
    await openPage(page, byName("study: chat"));
    expect(await page.evaluate(() => document.documentElement.classList.contains("reduce-animations"))).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--motion-base").trim())).toMatch(/^0?\.01ms$/);
    await switchTool(page);
    await page.waitForTimeout(50);
    expect((await running(page)).join("\n")).toBe("");
  });
});
