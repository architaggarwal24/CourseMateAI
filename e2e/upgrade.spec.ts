import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, PLAN_NOTICE } from "./fixtures/api";
import { settle } from "./helpers";

// "You've been upgraded": a plan given by the owner shows once, as a calm card in Study and a pixel party in Hero.
test("the upgrade window shows once in Study: who it's from, the note, what's new", async ({ page }) => {
  await mockApi(page, { planNotice: PLAN_NOTICE });
  const seen = page.waitForRequest((r) => r.url().endsWith("/api/v1/account/plan-notice") && r.method() === "POST");
  await page.goto("/today");
  const dialog = page.getByRole("dialog", { name: "You've been upgraded to Sage" });
  await expect(dialog).toBeVisible();
  expect((await seen).postDataJSON()).toEqual({ id: 11 });
  await expect(dialog).toContainText("A gift from Archit");
  await expect(dialog).toContainText("Thanks for testing CourseMateAI!");
  await expect(dialog).toContainText("Up to 50 PDFs (was 3)");
  await expect(dialog.getByRole("link", { name: "Start a review" })).toHaveAttribute("href", "/study?tab=review");
  await settle(page);
  const axe = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("in Hero it's the pixel celebration, and Try it goes to the new feature", async ({ page }) => {
  await mockApi(page, { planNotice: PLAN_NOTICE });
  await page.goto("/quests");
  const dialog = page.getByRole("dialog", { name: "Upgraded!" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-variant=play]")).toBeVisible();
  await dialog.getByRole("link", { name: "Start a review" }).click();
  await expect(page).toHaveURL(/tab=review/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the owner leaves a note and previews the window before saving", async ({ page }) => {
  await mockApi(page);
  await page.goto("/account/admin");
  await page.getByRole("button", { name: "Manage ravi@example.com" }).click();
  const editor = page.getByRole("dialog", { name: "Ravi Kumar" });
  await editor.getByRole("combobox", { name: "Plan" }).selectOption("archmage");
  await editor.getByLabel("Note for them (optional)").fill("You're one of our first testers!");
  await editor.getByRole("button", { name: "Preview their window" }).click();
  const preview = page.getByRole("dialog", { name: "You've been upgraded to Archmage" });
  await expect(preview).toContainText("Preview: this is what they'll see. Nothing is saved.");
  await expect(preview).toContainText("You're one of our first testers!");
  await preview.getByRole("button", { name: "Done" }).click();
  await expect(preview).toBeHidden();
  const put = page.waitForRequest((r) => /\/admin\/users\/2\/plan$/.test(r.url()) && r.method() === "PUT");
  await editor.getByRole("button", { name: "Save plan" }).click();
  expect((await put).postDataJSON()).toMatchObject({ tier: "archmage", note: "You're one of our first testers!" });
  await expect(page.getByText(/They'll get a congratulations window/)).toBeVisible();
});
