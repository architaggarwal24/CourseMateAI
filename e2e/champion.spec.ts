import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// The pixel champion is the avatar everywhere (Phase 3, Stage 1): picked in the Champion tab, saved on the account,
// drawn in the Hero header, the sidebar menu, the shop and the inventory; old Avatar / Hero Forge links land here.

const roster = (page: Page) => page.getByRole("radiogroup", { name: "Choose your champion" });
const header = (page: Page) => page.getByTestId("hero-header-champion");

test("choosing a champion saves it on the account and every avatar shows it", async ({ page }) => {
  await mockApi(page);
  await page.goto("/hero?tab=champion");
  await expect(roster(page).getByRole("radio", { checked: true })).toContainText("Kaien");
  await expect(header(page)).toHaveAttribute("aria-label", /^Your champion, Kaien/);
  await expect(roster(page).getByRole("radio", { name: /Kaien/ }).getByText("Level 2")).toBeVisible();

  const saved = page.waitForRequest((r) => r.url().endsWith("/avatar/champion") && r.method() === "PUT");
  await roster(page).getByRole("radio", { name: /Mira/ }).click();
  expect((await saved).postDataJSON()).toEqual({ champion_id: "mira" });
  await expect(header(page)).toHaveAttribute("aria-label", /^Your champion, Mira/);
  await expect(header(page).locator(".champ-avatar[data-champion='mira']")).toBeVisible();
  // the picked champion's kit and mastery skins follow the pick (Phase 3 Stage 2)
  await expect(page.getByTestId("champion-kit")).toContainText("Passive · Quiet Study");
  await expect(page.getByRole("list", { name: "Mira's mastery skins" }).getByRole("listitem")).toHaveCount(3);

  // the account remembers it: a fresh load (cache cleared) comes back with Mira
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(roster(page).getByRole("radio", { checked: true })).toContainText("Mira");
  await expect(header(page)).toHaveAttribute("aria-label", /^Your champion, Mira/);
});

test("old Avatar and Hero Forge links open the Champion tab", async ({ page }) => {
  await mockApi(page);
  for (const old of ["/hero?tab=avatar", "/hero?tab=forge", "/avatar", "/avatar/hero-forge"]) {
    await page.goto(old);
    await expect(page).toHaveURL(/\/hero\?tab=champion$/);
    await expect(roster(page)).toBeVisible();
  }
});

test("the shop's try-on dresses the champion, and the inventory shows the same champion", async ({ page }) => {
  await mockApi(page);
  await page.goto("/hero?tab=shop");
  await page.getByRole("button", { name: /Head Pieces/ }).click();
  await page.getByRole("button", { name: "Try on Red Headband" }).click();
  await expect(page.getByTestId("shop-preview").getByRole("img", { name: "Kaien, trying on Red Headband" })).toBeVisible();
  await expect(header(page)).toHaveAttribute("aria-label", "Your champion, Kaien, trying on Red Headband");
  await page.goto("/hero?tab=inventory");
  await expect(page.getByRole("img", { name: "Kaien, your champion, in your skins" })).toBeVisible();
});

test("the champion's sprites are painted, and the Champion tab passes axe", async ({ page }) => {
  await mockApi(page);
  await page.goto("/hero?tab=champion");
  await expect(roster(page)).toBeVisible();
  const stage = page.getByTestId("champion-stage").locator("canvas");
  await expect.poll(() => stage.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  })).toBeGreaterThan(400);
  // the same bar as e2e/axe.spec.ts: no serious or critical findings
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
});

/** The preview canvas, sampled a few times over one idle cycle: how many different pictures it showed. */
const distinctFrames = (page: Page) => page.getByTestId("champion-stage").locator("canvas").evaluate(async (c: HTMLCanvasElement) => {
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) { seen.add(c.toDataURL()); await new Promise((r) => setTimeout(r, 140)); }
  return seen.size;
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("every sprite is a still frame", async ({ page }) => {
    await mockApi(page);
    await page.goto("/hero?tab=champion");
    await expect(roster(page)).toBeVisible();
    await page.waitForTimeout(300);
    const playing = await page.locator("canvas[data-playing]").evaluateAll((cs) => cs.map((c) => c.getAttribute("data-playing")));
    expect(playing.length).toBeGreaterThan(6);
    expect(new Set(playing)).toEqual(new Set(["false"]));
    expect(await distinctFrames(page)).toBe(1);
  });
});

test("without reduced motion the champion idles (the frames change)", async ({ page }) => {
  await mockApi(page);
  await page.goto("/hero?tab=champion");
  await expect(roster(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect(await distinctFrames(page)).toBeGreaterThan(1);
});
