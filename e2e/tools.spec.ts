import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";

// The free tools (SEO stage 3): public pages that work right there, no account.
test("the flashcard maker: paste notes, get cards that flip, then the invitation to sign up", async ({ page }) => {
  const { unanswered } = await mockApi(page, { signedIn: false });
  await page.goto("/tools/ai-flashcard-maker");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Turn your notes into flashcards");
  await page.getByRole("button", { name: "Try sample notes" }).click();
  await page.getByRole("button", { name: /Make flashcards/ }).click();
  const card = page.getByRole("list", { name: "Your flashcards" }).getByRole("button").first();
  await expect(card).toContainText("What is chlorophyll?");
  await card.click();
  await expect(card).toContainText("absorbs light");
  await expect(page.getByText("4 free runs left today")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start studying free" }).first()).toHaveAttribute("href", "/login?mode=register");
  const axe = await new AxeBuilder({ page }).include("[data-testid='free-tool']").analyze();
  expect(axe.violations).toEqual([]);
  expect(unanswered).toEqual([]);
});

test("the revision planner works in the browser, with no request", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  const calls: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/")) calls.push(r.url()); });
  await page.goto("/tools/revision-planner");
  const d = new Date(); d.setDate(d.getDate() + 45);
  await page.getByLabel("Exam date").fill(d.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Use Class 10 Science chapters" }).click();
  await page.getByRole("button", { name: /Make my plan/ }).click();
  await expect(page.getByRole("list", { name: "Your revision plan" })).toContainText("Study: Chemical Reactions and Equations");
  expect(calls.filter((u) => !/\/api\/v1\/(auth|hud|me)/.test(u))).toEqual([]);
});

test("every tool page links to the others, and the hub lists them all", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/tools");
  for (const name of ["Flashcard maker", "Quiz generator", "Notes summarizer", "Revision planner"]) {
    await expect(page.getByRole("main").getByRole("link", { name })).toBeVisible();
  }
});
