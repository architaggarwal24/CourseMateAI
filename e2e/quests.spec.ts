import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// Stage Q1: the quest board. Every quest is a sealed scroll; "Answer the call" goes where it is done; a finished
// one's seal breaks and pays.
test("the quest board: scrolls by kind, Answer the call, and a hunt's seal breaking for its lost page", async ({ page }) => {
  const { unanswered } = await mockApi(page);
  await page.goto("/hero?tab=quests");
  for (const title of ["Today's quests", "Weekly trials", "Hunts", "Kaien's story"]) await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "Trial of Questions" }).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");

  const cyclops = page.getByRole("listitem", { name: "Hunt the Cyclops" });
  await expect(cyclops.getByRole("link", { name: "Answer the call" })).toHaveAttribute("href", "/hero?tab=arena&topic=mechanics");
  await expect(page.getByRole("listitem", { name: "Trial of Memory" }).getByRole("link", { name: "Answer the call" })).toHaveAttribute("href", "/study?tab=review");

  await settle(page);
  const axe = await new AxeBuilder({ page }).include(".qboard").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);

  const hunt = page.getByRole("listitem", { name: "Hunt the Minotaur" });
  await expect(hunt).toContainText("Lost page: Minotaur");
  const claimed = page.waitForRequest((r) => r.url().endsWith("/quests/claim"));
  await hunt.getByRole("button", { name: /Break the seal/ }).click();
  expect((await claimed).postDataJSON()).toEqual({ id: "hunt:minotaur" });
  await expect(page.getByText("A lost page of the Minotaur is in your", { exact: false })).toBeVisible();
  await expect(hunt).toHaveAttribute("data-state", "open");
  expect(unanswered).toEqual([]);
});
