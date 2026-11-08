import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// Stage S1: buying asks first (what it costs, what's left), then celebrates with a reveal and confetti.
test("buy: a confirm screen, then a reveal with confetti and Equip now", async ({ page }) => {
  await mockApi(page, { buyable: "armor_hoodie_gray" });
  await page.goto("/hero?tab=shop");
  await page.getByRole("button", { name: /Outfits/ }).click();
  const card = page.locator("[data-item-id='armor_hoodie_gray']");
  await card.getByRole("button", { name: "Buy" }).click();
  const ask = page.getByRole("dialog", { name: /^Buy .+\?$/ });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText("Your coins");
  await expect(ask).toContainText("-120");
  await settle(page);
  const axe = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  const bought = page.waitForRequest((r) => r.url().endsWith("/shop/purchase"));
  await ask.getByRole("button", { name: /^Buy for 120/ }).click();
  await bought;
  const done = page.getByTestId("buy-done");
  await expect(done).toBeVisible();
  await expect(done.locator("canvas.buy-done__confetti")).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "coins left" })).toContainText("200");
  await expect(page.getByRole("button", { name: "Equip now" })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(done).toBeHidden();
});
