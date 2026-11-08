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

  // counted in the page, the frame after the key: one leaf turning, bent strip by strip
  const turning = await page.evaluate(() => new Promise<[number, number]>((done) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    requestAnimationFrame(() => done([document.querySelectorAll(".tome-leaf").length, document.querySelectorAll(".tome-leaf .tome-strip").length]));
  }));
  expect(turning[0]).toBe(1);
  expect(turning[1]).toBeGreaterThan(5);
  await expect(folio).toHaveText("Pages 3–4 of 29");
  await expect(page.locator(".tome-leaf")).toHaveCount(0);

  await page.keyboard.press("Home");
  await expect(folio).toHaveText("Pages 1–2 of 29");
  const stack = await page.getByRole("button", { name: /^Kitsune\b.*page 9$/ }).evaluate((b) => new Promise<number>((done) => {
    (b as HTMLButtonElement).click();
    requestAnimationFrame(() => done(document.querySelectorAll(".tome-leaf").length));
  }));
  expect(stack).toBeGreaterThan(1);                                            // a stack, not a jump
  await expect(folio).toHaveText("Pages 9–10 of 29");
  await expect(page.getByRole("group", { name: "Kitsune", exact: true })).toBeVisible();
});
