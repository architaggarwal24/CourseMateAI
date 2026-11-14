import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// The two worlds: the Hero world's own touches (Stage 4 on).

test("Stage 4: the Hero world has its pixel cursor and its scene; Options switch on scanlines, kept after a reload", async ({ page }, info) => {
  const { unanswered } = await mockApi(page);
  await page.goto("/quests");
  const shell = page.locator(".app-shell");
  await expect(shell).toHaveAttribute("data-world", "hero");
  await expect(shell).toHaveAttribute("data-cursor", "");
  if (!info.project.name.startsWith("mobile")) {
    const scene = page.getByTestId("hero-scene");
    await expect(scene).toBeAttached();
    await expect(scene).toHaveAttribute("data-weather", /clear|cloudy|rain/);
  }
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Paused" }).getByRole("button", { name: "Options" }).click();
  const options = page.getByRole("dialog", { name: "Options" });
  await options.getByRole("button", { name: "CRT scanlines" }).click();
  await expect(options.getByRole("button", { name: "CRT scanlines" })).toHaveAttribute("aria-pressed", "true");
  await expect(shell).toHaveAttribute("data-scanlines", "");
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-scanlines", "");
  // Study never gets them
  await page.goto("/today");
  await expect(page.locator(".app-shell")).not.toHaveAttribute("data-scanlines", "");
  await expect(page.locator(".app-shell")).not.toHaveAttribute("data-cursor", "");
  expect(unanswered).toEqual([]);
});

test("Stage 5: the bridges - reviews due and the weekly invasion in Hero; Insight and the invasion's hint in Study", async ({ page }) => {
  const { unanswered } = await mockApi(page);
  await page.goto("/quests");
  await expect(page.getByRole("region", { name: /reviews? awaits?/ })).toBeVisible();
  const invasion = page.getByRole("region", { name: "Invasion! The Kraken comes" });
  await expect(invasion).toContainText("ATP, Mitochondria, Nucleus");
  await expect(invasion.getByRole("link", { name: /Face the invasion/ })).toHaveAttribute("href", /\/arena\?invasion=1&doc=/);
  await page.getByRole("region", { name: /reviews? awaits?/ }).getByRole("link", { name: /^Review \d+ cards?$/ }).click();
  await expect(page).toHaveURL(/\/study\?tab=review/);
  await page.goto("/today");
  await expect(page.getByText(/Something stirs in the Hero world/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Hero" }).getByRole("progressbar", { name: "Insight" })).toBeVisible();
  expect(unanswered).toEqual([]);
});

test("Stage 6: Study's focus mode clears the frame and runs the clock; Study's accent colour sticks", async ({ page }) => {
  const { unanswered } = await mockApi(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start a focus session" }).click();
  const bar = page.getByRole("region", { name: "Focus mode" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("timer")).toHaveText(/^2[45]:\d\d$/);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();      // the frame steps aside
  await bar.getByRole("radio", { name: "Rain" }).click();
  await expect(bar.getByRole("radio", { name: "Rain" })).toHaveAttribute("aria-checked", "true");
  await bar.getByRole("button", { name: /Leave focus/ }).click();
  await expect(bar).toBeHidden();
  await page.goto("/account/settings");
  await page.getByRole("radiogroup", { name: "Accent colour" }).getByRole("radio", { name: "Teal" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "teal");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "teal");
  expect(unanswered).toEqual([]);
});

test("Stage 7: a season's banner on the hub and Today; the Adventurer card downloads as an image", async ({ page }) => {
  const { unanswered } = await mockApi(page);
  await page.goto("/arena");
  const banner = page.getByRole("region", { name: "Finals Week" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: /Face The Exam Warden/ })).toBeVisible();
  await page.goto("/arena");
  // the hero profile: the button beside the sound switch; on a phone (no side panel), in the pause menu
  if (page.viewportSize()!.width < 768) {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("dialog", { name: "Paused" }).getByRole("link", { name: "Hero profile" }).click();
  } else await page.getByRole("link", { name: "Hero profile" }).click();
  await expect(page).toHaveURL(/\/adventurer$/);
  const card = page.getByTestId("adventurer-card");
  await expect(card).toContainText("alice");
  await expect(card).toContainText("5/13 hunted");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download as image/ }).click();
  expect((await download).suggestedFilename()).toBe("adventurer-card.png");
  await page.goto("/today");
  await expect(page.getByText(/Finals Week is on in the Hero world/)).toBeVisible();
  expect(unanswered).toEqual([]);
});
