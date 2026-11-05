import { test, expect } from "@playwright/test";

import { mockApi } from "./fixtures/api";

// Form errors are tied to their field: aria-invalid + aria-describedby pointing at the message.
test.describe("form errors", () => {
  test("signup step 1: every invalid field names its error through aria-describedby", async ({ page }) => {
    await mockApi(page, { signedIn: false });
    await page.goto("/login");
    await page.getByRole("button", { name: /Sign up/ }).click();
    await page.getByRole("button", { name: "Create account", exact: true }).click();  // nothing filled in

    const invalid = page.locator("input[aria-invalid='true']");
    expect(await invalid.count()).toBeGreaterThanOrEqual(3);
    for (const input of await invalid.all()) {
      const ids = ((await input.getAttribute("aria-describedby")) ?? "").split(" ").filter(Boolean);
      expect(ids.length, "aria-describedby present").toBeGreaterThan(0);
      const texts = await Promise.all(ids.map((id) => page.locator(`[id="${id}"]`).innerText().catch(() => "")));
      expect(texts.join(" ").trim().length, `description of ${await input.getAttribute("name")}`).toBeGreaterThan(0);
    }
    // the first problem gets focus, so a keyboard user lands on it
    await expect(page.locator("input[aria-invalid='true']").first()).toBeFocused();
  });

  test("login: a wrong password is announced and reachable", async ({ page }) => {
    await mockApi(page, { signedIn: false });
    await page.goto("/login");
    await page.getByLabel("Email").fill("alice@example.com");
    await page.getByLabel("Password", { exact: true }).fill("not-the-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.locator(".ui-card--danger[role=alert]")).toContainText(/don't match an account/i);
  });
});
