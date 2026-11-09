import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures/api";
import { settle } from "./helpers";

// Phase 3 Stage 3B: a chat answer cites its passages as [n]; a citation opens the PDF beside the chat at its page,
// drawn by pdf.js, with the passage highlighted.

const PDF = readFileSync(join(__dirname, "fixtures", "cell-biology.pdf"));
const PASSAGE = "Mitochondria produce most of the cell's ATP through oxidative phosphorylation. Glycolysis happens in the cytoplasm";
const CITES = [
  { n: 1, doc_id: "doc-1", doc_name: "Cell Biology.pdf", page: 2, label: "Cell Biology.pdf · p.2", snippet: PASSAGE.slice(0, 80), text: PASSAGE },
  { n: 2, doc_id: "doc-1", doc_name: "Cell Biology.pdf", page: 3, label: "Cell Biology.pdf · p.3", snippet: "Osmosis moves water…",
    text: "Osmosis moves water across a membrane from low to high solute concentration." },
];

async function chatServer(page: import("@playwright/test").Page) {
  await mockApi(page);
  await page.route("**/api/v1/chat/stream", (route) => route.fulfill({
    status: 200, contentType: "text/event-stream",
    body: `event: token\ndata: ${JSON.stringify({ text: "Most ATP is made by **mitochondria** [1]. Water crosses membranes by osmosis [2]." })}\n\n` +
          `event: sources\ndata: ${JSON.stringify({ mode: "chat", sources: CITES.map((c) => c.label), citations: CITES, blocked: false, needs_clarification: false, rewards: null })}\n\n`,
  }));
  await page.route("**/api/v1/documents/doc-1/file", (route) => route.fulfill({ status: 200, contentType: "application/pdf", body: PDF }));
}

test("a citation opens the PDF at its page with the passage highlighted", async ({ page }, info) => {
  await chatServer(page);
  await page.goto("/study?tab=chat&doc=doc-1");
  await page.getByRole("textbox", { name: "Message" }).fill("Where is ATP made?");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("list", { name: "Sources" })).toBeVisible();
  await page.getByRole("button", { name: "Source 1", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Cell Biology.pdf" });
  await expect(panel.getByText("Page 2 of 3")).toBeVisible();
  await expect(panel.locator(".pdf-mark").first()).toBeVisible();                    // the passage, found and marked
  const painted = await panel.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++;
    return dark;
  });
  expect(painted).toBeGreaterThan(200);                                               // pdf.js drew the text
  if (process.env.SHOT_DIR) { await page.waitForTimeout(500); await page.screenshot({ path: `${process.env.SHOT_DIR}/cite-${info.project.name}.png` }); }
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`), `${info.project.name}: viewer axe`).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Source 1", exact: true })).toBeFocused();         // focus comes back
  await page.getByRole("button", { name: /Open source ?\[2\]/ }).click();
  await expect(page.getByRole("complementary", { name: "Cell Biology.pdf" }).getByText("Page 3 of 3")).toBeVisible();
});

// Round 7: notes in a format, with the same page links, a Sources list and print / copy / Markdown exports.
test("notes: pick a format, every [n] opens its page, tappable and accessible", async ({ page }, info) => {
  await chatServer(page);
  let asked: Record<string, unknown> = {};
  await page.route("**/api/v1/notes", async (route) => {
    asked = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      mode: "notes", format: "cornell", sources: [], citations: CITES, rewards: null,
      content: "# Cell energy — Cornell notes\n\n| Cue | Notes |\n| --- | --- |\n| Where is ATP made? | In the **mitochondria** [1]. |\n| What is osmosis? | Water moving across a membrane [2]. |\n\n## Summary\n\nCells make ATP in mitochondria [1].",
    }) });
  });
  await page.goto("/study?tab=notes&doc=doc-1");
  await page.getByRole("textbox", { name: /notes on/ }).fill("cell energy");
  await page.getByText("Cornell", { exact: true }).click();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/notes-setup-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Generate notes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Cornell notes/ })).toBeVisible();
  expect(asked).toMatchObject({ topic: "cell energy", format: "cornell", session_id: "doc-1" });
  await expect(page.getByRole("button", { name: "Print / PDF" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Sources" }).getByRole("listitem")).toHaveCount(2);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/notes-${info.project.name}.png` });
  await settle(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`), `${info.project.name}: notes axe`).toEqual([]);
  await page.getByRole("button", { name: "Source 1", exact: true }).first().click();
  await expect(page.getByRole("complementary", { name: "Cell Biology.pdf" }).getByText("Page 2 of 3")).toBeVisible();
});
