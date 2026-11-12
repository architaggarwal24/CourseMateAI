import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// Stage R3: the daily chest opens with coins raining; a level gained anywhere gets its own screen.
test("the daily chest: open it once, coins rain, the loot is shown", async ({ page }) => {
  await mockApi(page);
  await page.goto("/quests");
  const chest = page.getByRole("region", { name: "Daily chest" });
  await expect(chest).toContainText("Streak bonus: +20% coins");
  await settle(page);
  const axe = await new AxeBuilder({ page }).include(".chest").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await chest.getByRole("button", { name: "Open the chest" }).click();
  await expect(chest.getByRole("status")).toContainText("+54 coins");
  await expect(chest.getByRole("status")).toContainText("Health Potion");
  await expect(page.locator("canvas.fx-coin-rain")).toHaveCount(1);
  await expect(chest).toContainText("3 days in a row");
  await page.reload();
  await expect(page.getByRole("region", { name: "Daily chest" })).toContainText("Opened today");
});

test("a level gained shows the level-up screen once", async ({ page }) => {
  await mockApi(page);
  // this browser last saw level 6; the server says 7
  // (only on the first load: init scripts run again on reload)
  await page.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("cmai_level_seen:1", "6"); } } catch { /* */ } });
  await page.goto("/quests");
  await expect(page.getByTestId("level-fanfare")).toBeVisible();              // the whole-screen LEVEL UP comes first
  const dialog = page.getByRole("dialog", { name: "Level up!" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Level 7")).toBeVisible();
  await expect(dialog).toContainText("+350 coins");
  await dialog.getByRole("button", { name: "Onward" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Today's quests" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Level up!" })).toHaveCount(0);
});
