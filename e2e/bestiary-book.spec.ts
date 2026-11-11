import { test, expect } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// Stage B3: the book's pages curl as they turn (a leaf of hinged strips), and choosing a creature in the contents
// turns every page up to it at once, as a thick stack, instead of jumping.
test("a page curls over; the contents turn a stack of pages to the creature", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the two-page spread is a wide-screen view");
  await mockApi(page);
  await page.goto("/bestiary");
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

// Round 7: the Scholar's desk - the book on a desk with the tier map and hunt record, living pages, a Hunt.
test("the desk: tier map, hunt record, a living page and its Hunt button", async ({ page }, info) => {
  await mockApi(page);
  await page.addInitScript(() => localStorage.setItem("cmai_tome_seen_v1", JSON.stringify({ written: [], tiers: [1] })));
  await page.goto("/bestiary");
  await expect(page.getByRole("navigation", { name: "The road through the book" })).toBeVisible();
  const ledger = page.getByRole("region", { name: "Hunt record" });
  await expect(ledger).toContainText("Next quarry");
  // a page written since the last visit: fresh ink, and its ritual plays when it opens
  const fresh = page.getByRole("button", { name: "Minotaur written in full" });
  await expect(fresh).toBeVisible();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/desk-${info.project.name}.png`, fullPage: true });
  await fresh.click();
  if (info.project.name === "desktop") {
    await expect(page.locator(".tome-burn").first()).toBeAttached();
    await page.waitForTimeout(700);
    if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/desk-burn-${info.project.name}.png` });
  }
  await expect(page.getByText("Fresh ink")).toHaveCount(0, { timeout: 6000 });
  const hunt = page.getByRole("link", { name: "Hunt it again" });
  await expect(hunt).toHaveAttribute("href", "/arena?hunt=minotaur");
  await page.getByRole("button", { name: "Provoke the Minotaur" }).click();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/desk-page-${info.project.name}.png` });
  await hunt.click();
  await expect(page.getByRole("heading", { name: "Hunt the Minotaur" })).toBeVisible();
  const sent = page.waitForRequest((r) => r.url().endsWith("/arena/battles") && r.method() === "POST");
  await page.getByLabel("Boss topic").fill("graph search");
  await page.getByRole("button", { name: /Summon/ }).click();
  expect((await sent).postDataJSON()).toMatchObject({ topic: "graph search", species: "minotaur" });
});
