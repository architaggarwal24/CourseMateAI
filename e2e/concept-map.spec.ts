import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// Phase 3 Stage 3B: the concept map tab - a constellation coloured by mastery, keyboard-navigable, with a list view.

test("the concept map draws the constellation and a star opens its actions", async ({ page }, info) => {
  const { unanswered } = await mockApi(page);
  await page.goto("/study?tab=map&doc=doc-1");
  const mobile = info.project.name.startsWith("mobile");
  if (mobile) {
    await expect(page.getByRole("button", { name: "Show as a list" })).toHaveAttribute("aria-pressed", "true");   // a list on a phone
    await page.getByRole("button", { name: "Show as a map" }).click();
  }
  const map = page.getByRole("group", { name: "Concept map: 8 concepts" });
  await expect(map).toBeVisible();
  const first = map.getByRole("button", { name: /^ATP\./ });
  await first.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("region", { name: "ATP" });
  await expect(panel.getByRole("link", { name: "Summon its boss" })).toHaveAttribute("href", "/hero?tab=arena&doc=doc-1&topic=ATP");
  await page.screenshot({ path: `previews/stage-3b-map-${info.project.name}.png` });
  await settle(page);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  expect(unanswered).toEqual([]);
});

test("the list view and a concept's quiz", async ({ page }, info) => {
  await mockApi(page);
  await page.goto("/study?tab=map&doc=doc-1");
  await page.getByRole("button", { name: "Show as a list" }).click();
  await page.getByRole("button", { name: /^Glycolysis/ }).click();
  await page.getByRole("link", { name: "Quick quiz on it" }).click();
  await expect(page).toHaveURL(/tab=quiz&doc=doc-1&topic=Glycolysis/);
  await expect(page.getByLabel("What topic would you like to be quizzed on?")).toHaveValue("Glycolysis");
  if (!info.project.name.startsWith("mobile")) {
    await page.screenshot({ path: `previews/stage-3b-map-quiz.png` });
  }
});
