import type { Page } from "@playwright/test";
import { mockApi } from "./fixtures/api";
import type { PageCase } from "./pages";

/** Opens a screen with the API mocked and waits until it has rendered (and settled). */
export async function openPage(page: Page, c: PageCase) {
  const mock = await mockApi(page, { signedIn: c.auth });
  await page.goto(c.path);
  if (c.before) {
    await page.getByRole("button", { name: /Register/ }).click();
    if (c.before === "register-step-2") {
      await page.getByLabel("Full Name").fill("Alice Example");
      await page.getByLabel("Username").fill("alice");
      await page.getByLabel("Email").fill("alice@example.com");
      await page.getByLabel("Password", { exact: true }).fill("correct-horse-1");
      await page.getByLabel("Confirm Password").fill("correct-horse-1");
      await page.getByRole("button", { name: "Next" }).click();
    }
  }
  await page.locator(c.ready).first().waitFor({ state: "visible" });
  await page.waitForLoadState("networkidle");
  // let enter animations finish before measuring contrast
  await page.waitForTimeout(600);
  return mock;
}
