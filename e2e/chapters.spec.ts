import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";

// Chapter pages (SEO stage 4): a draft can be opened to check it, but stays out of search until a person reviews it.
test("a draft chapter page: summary, flashcards and a quiz that marks answers; noindex and no flashcard markup yet", async ({ page, request }) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/cbse/class-10/science/chemical-reactions-and-equations");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chemical Reactions and Equations");
  await expect(page.getByText(/Draft: not yet checked/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Chemical Reactions and Equations flashcards" }).getByRole("listitem")).toHaveCount(20);
  const q1 = page.getByRole("group", { name: "Question 1 options" });
  await q1.getByRole("button", { name: "A gas being given off when two solutions mix" }).click();
  await expect(page.getByText(/^Right\./)).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("main").analyze();
  expect(axe.violations).toEqual([]);

  const body = await (await request.get("/cbse/class-10/science/chemical-reactions-and-equations")).text();
  expect(body).toMatch(/<meta name="robots" content="noindex/);
  expect(body).not.toContain('"eduQuestionType"');
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/cbse/");
});

test("the chapter hub lists every chapter, and moves on to the next one", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/cbse/class-10/science");
  await page.getByRole("link", { name: "Chapter 2: Acids, Bases and Salts" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Acids, Bases and Salts");
  await page.getByRole("link", { name: /Chapter 3: Metals and Non-Metals →/ }).click();
  await expect(page).toHaveURL(/\/cbse\/class-10\/science\/metals-and-non-metals$/);
  expect((await page.request.get("/cbse/class-10/history")).status()).toBe(404);
});
