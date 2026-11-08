import { test, expect } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// Stage B3: the book's pages curl as they turn (a leaf of hinged strips), and choosing a creature in the contents
// turns every page up to it at once, as a thick stack, instead of jumping.
test("a page curls over; the contents turn a stack of pages to the creature", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the two-page spread is a wide-screen view");
  await mockApi(page);
  await page.goto("/hero?tab=bestiary");
  const folio = page.locator(".tome-folio");
  await expect(folio).toHaveText("Pages 1–2 of 29");

  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".tome-leaf")).toHaveCount(1);                    // one leaf turning
  expect(await page.locator(".tome-leaf .tome-strip").count()).toBeGreaterThan(5);   // bent, strip by strip
  await expect(folio).toHaveText("Pages 3–4 of 29");
  await expect(page.locator(".tome-leaf")).toHaveCount(0);

  await page.keyboard.press("Home");
  await expect(folio).toHaveText("Pages 1–2 of 29");
  await page.getByRole("button", { name: /^Kitsune\b.*page 9$/ }).click();
  expect(await page.locator(".tome-leaf").count()).toBeGreaterThan(1);       // a stack, not a jump
  await expect(folio).toHaveText("Pages 9–10 of 29");
  await expect(page.getByRole("group", { name: "Kitsune", exact: true })).toBeVisible();
});
