import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// Phase 3 Stage 3A: exam mode. Set up, take it with the keyboard (no hints), submit, read the results.

async function axeClean(page: import("@playwright/test").Page, label: string) {
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`).join("\n"), `axe on ${label}`).toBe("");
}

test("a mock exam from setup to results, keyboard first", async ({ page }, info) => {
  await mockApi(page);
  await page.goto("/study?tab=exam&doc=doc-1");
  await expect(page.getByRole("heading", { name: "Mock exam" })).toBeVisible();
  await page.getByRole("button", { name: "10 questions" }).click();
  await page.getByRole("button", { name: /Osmosis/ }).click();
  await page.getByRole("button", { name: "Start exam" }).click();

  await expect(page.getByRole("heading", { name: "Which organelle makes most of the cell's ATP?" })).toBeVisible();
  await expect(page.getByRole("timer")).toContainText("3:4");
  await axeClean(page, `${info.project.name}: exam question`);
  await page.keyboard.press("2");                                              // Mitochondria (right)
  await expect(page.getByRole("radio", { name: /Mitochondria/ })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading", { name: "What moves across a membrane in osmosis?" })).toBeVisible();
  await page.keyboard.press("2");                                              // Glucose (wrong)
  await page.keyboard.press("f");
  await expect(page.getByRole("button", { name: "Question 2, answered, flagged" })).toBeVisible();

  await page.getByRole("button", { name: /^Submit$/ }).click();
  const dialog = page.getByRole("dialog", { name: "Submit your exam?" });
  await expect(dialog).toContainText("1 of 3 questions have no answer yet");
  await dialog.getByRole("button", { name: "Submit exam" }).click();

  await expect(page.getByRole("heading", { name: "Exam results" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Osmosis" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save as PDF/ })).toBeVisible();
  await expect(page.getByText("2 missed questions are now in your review queue", { exact: false })).toBeVisible();
  await axeClean(page, `${info.project.name}: exam results`);
});
