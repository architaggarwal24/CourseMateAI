import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PAGES } from "./pages";
import { openPage } from "./helpers";

// Done = zero serious or critical findings on every screen, at desktop width and at 360px.
for (const c of PAGES) {
  test(`axe: ${c.name}`, async ({ page }, info) => {
    await openPage(page, c);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    const report = blocking.map((v) =>
      `${v.impact} ${v.id}: ${v.help}\n` + v.nodes.slice(0, 6).map((n) => `    ${n.target.join(" ")}\n      ${(n.failureSummary ?? "").split("\n").slice(1, 3).join(" | ")}`).join("\n"));
    expect(report.join("\n"), `${info.project.name} · ${c.name}: serious/critical axe findings`).toBe("");
  });
}
