import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";

// Phase 3 Stage 3A: the daily review. The nav carries the due count; the review is keyboard first (Space shows the
// answer, 1-4 grade it) and swipeable on a phone; clearing the queue ends on "All caught up".

async function axeClean(page: import("@playwright/test").Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`).join("\n"), `axe on ${label}`).toBe("");
}

test("the due count is on the Study nav and the Review tab, and the keyboard clears the queue", async ({ page }, info) => {
  await mockApi(page);
  await page.goto("/study?tab=chat&doc=doc-1");
  const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).first();
  await expect(nav.getByRole("link", { name: /Study/ })).toContainText("2 cards to review");
  const tabs = page.getByRole("navigation", { name: "Study tools" });
  await expect(tabs.getByRole("link", { name: /Review/ })).toContainText("2 cards due");

  await tabs.getByRole("link", { name: /Review/ }).click();
  const card = page.getByTestId("review-card");
  await expect(card).toContainText("Which organelle makes most of the cell's ATP?");
  await expect(card).toContainText("Cell Biology.pdf");
  await page.keyboard.press("Space");
  await expect(card).toContainText("Mitochondria");
  await expect(page.getByRole("button", { name: /^Good/ })).toContainText("10m");
  await axeClean(page, `${info.project.name}: review answer`);
  await page.keyboard.press("3");
  await expect(card).toContainText("What does osmosis move across a membrane?");
  await page.keyboard.press("Space");
  await page.keyboard.press("4");
  await expect(page.getByRole("heading", { name: "All caught up" })).toBeVisible();
  await expect(page.getByText(/You reviewed 2 cards this session/)).toBeVisible();
  await expect(nav.getByTestId("review-badge")).toHaveCount(0);
  await axeClean(page, `${info.project.name}: all caught up`);
});

test("on a phone the answer is tapped open and swiped right for Good", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-360", "touch layout");
  await mockApi(page);
  await page.goto("/study?tab=review&doc=doc-1");
  const card = page.getByTestId("review-card");
  await card.click();
  await expect(card).toContainText("Mitochondria");
  const grade = page.waitForRequest((r) => r.url().endsWith("/review/grade") && r.method() === "POST");
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + i * 22, box.y + box.height / 2, { steps: 2 });
  await page.mouse.up();
  expect((await grade).postDataJSON()).toMatchObject({ item_id: 1, rating: 3, reps: 0 });
  await expect(card).toContainText("What does osmosis move across a membrane?");
});
