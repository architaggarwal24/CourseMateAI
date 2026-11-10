import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

const withProviders = async (page: import("@playwright/test").Page) => {
  await mockApi(page, { signedIn: false });
  await page.route("**/api/v1/auth/config", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ google: true, github: true, email_delivery: true, verification_required: true, invite_only: false }) }));
};

// Google and GitHub: a button each, only when the server has it set up.
test("the login page offers each provider that's set up, and sends the browser to it", async ({ page }) => {
  await withProviders(page);
  let asked: unknown = null;
  await page.route("**/api/auth/sign-in/social", async (route) => {
    asked = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "/login?mode=register", redirect: true }) });
  });
  await page.goto("/login");
  for (const name of ["Continue with Google", "Continue with GitHub"]) await expect(page.getByRole("button", { name })).toBeVisible();
  await settle(page);
  const axe = await new AxeBuilder({ page }).include("main").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await expect(page.getByRole("button", { name: "Continue with Microsoft" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL(/mode=register/);
  expect(asked).toMatchObject({ provider: "github", errorCallbackURL: "/login?sso=github" });
});

test("a sign-in that comes back with an error says what happened", async ({ page }) => {
  await withProviders(page);
  await page.goto("/login?sso=github&error=account_not_linked");
  await expect(page.getByText("There's already a CourseMateAI account with this email.", { exact: false })).toBeVisible();
});

test("no providers set up: no buttons", async ({ page }) => {
  await mockApi(page, { signedIn: false });
  await page.goto("/login");
  await expect(page.getByRole("textbox", { name: /email/i }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue with/ })).toHaveCount(0);
});
