import { test, expect } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// Round 7 stage 2: a landing page for visitors, the app behind a login, and logging out lands back on it.
test("logged out: '/' is the landing page, and its buttons lead to sign-up and log-in", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Your PDFs, turned into a tutor/);
  // the section links are in the top bar on wide screens (phones scroll the page instead)
  if ((page.viewportSize()?.width ?? 0) >= 900) await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link")).toHaveText(["Features", "How it works", "The game", "Plans", "FAQ"]);
  await expect(page.getByRole("heading", { name: "Start free. Upgrade when the exams get serious." })).toBeAttached();
  await expect(page.locator(".landing-plan")).toHaveCount(4);
  await page.getByRole("link", { name: "Start studying free" }).first().click();
  await expect(page).toHaveURL(/\/login\?mode=register/);
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
});

test("logged out: an app page sends you to log in, and back to it afterwards", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/study?tab=quiz");
  await expect(page).toHaveURL(/\/login\?next=%2Fstudy%3Ftab%3Dquiz/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("signed in: '/' goes straight to Today", async ({ page, context, baseURL }) => {
  await mockApi(page);
  await context.addCookies([{ name: "coursemate.session_token", value: "e2e", url: baseURL! }]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/today$/);
});

test("log out lands on the landing page", async ({ page, context, baseURL }) => {
  await mockApi(page);
  await page.goto("/account");
  await page.route("**/api/v1/auth/logout", async (route) => {
    await context.clearCookies();
    await route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" });
  });
  await context.addCookies([{ name: "coursemate.session_token", value: "e2e", url: baseURL! }]);
  await page.getByRole("button", { name: /Sign out/ }).first().click();
  await expect(page).toHaveURL(baseURL!.replace(/\/$/, "") + "/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/turned into a tutor/);
});
