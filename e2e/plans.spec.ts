import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PLANS, mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// Phase 3 Stage 4a: Account -> Plan & usage, and the "See plans" way out of a plan limit.

test("the plan, its meters and the plans to compare", async ({ page }, info) => {
  const { unanswered } = await mockApi(page);
  await page.goto("/account/usage");
  await expect(page.getByRole("heading", { name: "Scholar", level: 2 })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "AI calls today" })).toHaveAttribute("aria-valuetext", "126 of 150");
  await expect(page.getByText("₹299")).toBeVisible();
  await page.screenshot({ path: `previews/stage-4a-usage-${info.project.name}.png`, fullPage: true });
  await settle(page);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  expect(unanswered).toEqual([]);
});

test("a plan limit offers See plans", async ({ page }) => {
  await mockApi(page);
  await page.route("**/api/v1/quiz", (route) => route.fulfill({
    status: 429, contentType: "application/json",
    body: JSON.stringify({ error: { code: "plan_limit", message: "You've used today's 25 AI calls. They come back at midnight (UTC), or upgrade for more.",
      action: "plans", details: { limit: "ai_calls_day", used: 25, allowed: 25, upgrade_tier: "scholar", upgrade_tier_name: "Scholar" } } }),
  }));
  await page.goto("/study?tab=quiz&doc=doc-1");
  await page.getByLabel("What topic would you like to be quizzed on?").fill("cells");
  await page.getByRole("button", { name: "Generate quiz" }).click();
  const link = page.getByRole("link", { name: "See plans" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/account\/usage/);
});

test("upgrading with the test payment provider", async ({ page }) => {
  await mockApi(page);
  const sub = { id: "sub_stub_1", provider: "stub", tier: "sage", tier_name: "Sage", period: "month", status: "active",
                current_end: "2026-12-04T00:00:00+00:00", cancel_at_period_end: false };
  let paid = false;
  await page.route("**/api/v1/plans", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...PLANS, payments_enabled: true }) }));
  await page.route("**/api/v1/billing", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ enabled: true, provider: "stub", key_id: "stub", subscription: paid ? sub : null }) }));
  await page.route("**/api/v1/billing/checkout", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    provider: "stub", subscription_id: "sub_stub_1", key_id: "stub", tier: "sage", tier_name: "Sage", period: "month", currency: "INR",
    amount: 299, prefill: { name: "Alice", email: "alice@example.com" } }) }));
  await page.route("**/api/v1/billing/stub/complete", (r) => { paid = true; return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sub) }); });
  await page.goto("/account/usage");
  const sage = page.locator(".pu-card", { has: page.getByRole("heading", { name: "Sage" }) });
  await sage.getByRole("button", { name: "Upgrade to Sage" }).click();
  const dialog = page.getByRole("dialog", { name: "Test payment" });
  await expect(dialog).toBeVisible();
  await settle(page);
  const axe = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await dialog.getByRole("button", { name: /Pay ₹299 \(test\)/ }).click();
  await expect(page.getByText(/renews on 4 Dec 2026/)).toBeVisible();
});
