import type { Page } from "@playwright/test";
import { mockApi } from "./fixtures/api";
import type { PageCase } from "./pages";

/**
 * Wait until nothing is mid-animation (a dialog popping in, a toast sliding in, a panel fading in), so axe measures
 * what the user ends up seeing: a half-faded panel otherwise reads as low contrast on a slower machine. Endless
 * animations (pulses) are left running.
 */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const running = () => document.getAnimations().filter((x) => {
      const t = x.effect?.getComputedTiming();
      return x.playState === "running" && t && Number.isFinite(t.endTime as number);
    });
    // motion/react may start a fade a frame or two after mount, and some of it is written to inline styles each frame:
    // done once two checks in a row see no finite animation running and no inline opacity / transform changing.
    const sample = () => [...document.querySelectorAll<HTMLElement>("[style*='opacity'], [style*='transform']")]
      .map((el) => `${el.style.opacity}|${el.style.transform}|${getComputedStyle(el).opacity}`).join(";");
    const until = Date.now() + 4000;
    let last = "", quiet = 0;
    // An element motion is fading in still has an inline opacity below 1 (a staggered list waits on a delay first).
    const fading = () => [...document.querySelectorAll<HTMLElement>("[style*='opacity']")]
      .some((el) => el.style.opacity !== "" && Number(el.style.opacity) < 1 && el.getClientRects().length > 0);
    while (Date.now() < until && quiet < 2) {
      await sleep(100);
      const busy = running();
      if (busy.length) { quiet = 0; await Promise.race([Promise.all(busy.map((x) => x.finished.catch(() => {}))), sleep(1500)]); continue; }
      if (fading()) { quiet = 0; continue; }
      const now = sample();
      quiet = now === last ? quiet + 1 : 0;
      last = now;
    }
  });
}

/** Opens a screen with the API mocked and waits until it has rendered (and settled). */
export async function openPage(page: Page, c: PageCase) {
  const mock = await mockApi(page, { signedIn: c.auth });
  await page.goto(c.path);
  if (c.before) {
    await page.getByRole("button", { name: /Sign up/ }).click();
    if (c.before === "register-step-2") {
      await page.getByLabel("Full Name").fill("Alice Example");
      await page.getByLabel("Username").fill("alice");
      await page.getByLabel("Email").fill("alice@example.com");
      await page.getByLabel("Password", { exact: true }).fill("correct-horse-1");
      await page.getByLabel("Confirm Password").fill("correct-horse-1");
      await page.getByRole("checkbox", { name: /I'm 12 or older/ }).check();
      await page.getByRole("button", { name: "Create account", exact: true }).click();
    }
  }
  await page.locator(c.ready).first().waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  // let enter animations finish before measuring contrast
  await page.waitForTimeout(600);
  return mock;
}
