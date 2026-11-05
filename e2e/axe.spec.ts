import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PAGES } from "./pages";
import { openPage, settle } from "./helpers";

// Done = zero serious or critical findings on every screen, at desktop width and at 360px, in light and dark mode
// (the Ink theme follows the device; dark is checked at desktop width only, to keep the run short).
for (const mode of ["light", "dark"] as const) for (const c of PAGES) {
  test(`axe: ${c.name}${mode === "dark" ? " (dark)" : ""}`, async ({ page }, info) => {
    test.skip(mode === "dark" && info.project.name !== "desktop", "dark mode is checked at desktop width");
    await page.emulateMedia({ colorScheme: mode });
    await openPage(page, c);
    await settle(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    const report = blocking.map((v) =>
      `${v.impact} ${v.id}: ${v.help}\n` + v.nodes.slice(0, 6).map((n) => `    ${n.target.join(" ")}\n      ${(n.failureSummary ?? "").split("\n").slice(1, 3).join(" | ")}`).join("\n"));
    expect(report.join("\n"), `${info.project.name} · ${mode} · ${c.name}: serious/critical axe findings`).toBe("");
  });
}
