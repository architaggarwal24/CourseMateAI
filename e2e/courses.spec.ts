import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { COURSE, DOCUMENT, DOCUMENT_2, mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// Phase 3 Stage 3B: a course groups PDFs; the header's name switches between courses and documents, and a course
// opens on its overview (progress, every tool over the whole course, its documents).

test("a course opens on its overview and every tool works on the whole course", async ({ page }, info) => {
  const { unanswered } = await mockApi(page, { documents: [DOCUMENT, DOCUMENT_2] });
  await page.goto(`/study?tab=overview&doc=${COURSE.id}`);
  const header = page.locator("header[aria-label='Active document']");
  await expect(header.getByText("Life sciences")).toBeVisible();
  await expect(header.getByText("2 PDFs")).toBeVisible();
  const overview = page.getByRole("region", { name: "Course overview" });
  await expect(overview.getByText("Concepts mastered")).toBeVisible();
  await expect(overview.getByText("40%")).toBeVisible();
  await expect(overview.getByRole("link", { name: "Ask the course" })).toHaveAttribute("href", `/study?tab=chat&doc=${COURSE.id}`);
  await page.screenshot({ path: `previews/stage-3b-course-${info.project.name}.png`, fullPage: false });
  await settle(page);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  expect(unanswered).toEqual([]);
});

test("the document name is a switcher between courses and documents", async ({ page }) => {
  await mockApi(page, { documents: [DOCUMENT, DOCUMENT_2] });
  await page.goto("/study?tab=quiz&doc=doc-1");
  const trigger = page.getByRole("button", { name: /switch course or PDF/ });
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /Life sciences/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Organic Chemistry\.pdf/ })).toBeVisible();
  await settle(page);
  const axe = await new AxeBuilder({ page }).include("[role=menu]").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("ArrowDown");
  await menu.getByRole("menuitem", { name: /Life sciences/ }).click();
  await expect(page).toHaveURL(new RegExp(`tab=overview&doc=${COURSE.id}`));
  await expect(page.getByRole("region", { name: "Course overview" })).toBeVisible();
  await page.getByRole("link", { name: "Quiz", exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`tab=quiz&doc=${COURSE.id}`));
});

test("Edit course opens the editor with the course's documents", async ({ page }) => {
  await mockApi(page, { documents: [DOCUMENT, DOCUMENT_2] });
  await page.goto(`/study?tab=overview&doc=${COURSE.id}`);
  await page.getByRole("button", { name: "Edit course" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit course" });
  await expect(dialog.getByLabel("Name")).toHaveValue("Life sciences");
  await expect(dialog.getByRole("checkbox", { name: /Cell Biology\.pdf/ })).toBeChecked();
  await settle(page);
  const axe = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
