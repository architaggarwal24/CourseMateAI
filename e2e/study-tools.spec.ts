import { test, expect } from "@playwright/test";
import { DOCUMENT, DOCUMENT_2, mockApi } from "./fixtures/api";

// Round 7 stage 1: the Study tool groups read as headings, a PDF can be deleted, and admins can test a model.
test("Learn and Practice are captions over their own tracks, not tabs", async ({ page }) => {
  await mockApi(page);
  await page.goto("/study?tab=chat&doc=doc-1");
  const nav = page.getByRole("navigation", { name: "Study tools" });
  const learn = nav.getByRole("group", { name: "Learn" });
  const practice = nav.getByRole("group", { name: "Practice" });
  await expect(learn.getByRole("link")).toHaveText(["Chat", "Notes", "Map"]);
  await expect(practice.getByRole("link")).toHaveText(["Quiz", "Flashcards", /^Review/, "Exam"]);
  // the caption is plain text above the track: not a link, not inside the tab track, no pointer cursor
  const cap = learn.locator(".ui-tabs__cap");
  await expect(cap).toHaveText("Learn");
  expect(await cap.evaluate((el) => ({ inTrack: !!el.closest(".ui-tabs__list"), cursor: getComputedStyle(el).cursor }))).toEqual({ inTrack: false, cursor: "default" });
  const capBox = (await cap.boundingBox())!;
  const chatBox = (await learn.getByRole("link", { name: "Chat" }).boundingBox())!;
  expect(capBox.y + capBox.height).toBeLessThanOrEqual(chatBox.y + 1);          // above the tabs, not beside them
});

test("delete a PDF: confirm, it's gone, back to its course", async ({ page }) => {
  await mockApi(page, { documents: [{ ...DOCUMENT }, { ...DOCUMENT_2 }] });
  await page.goto("/study?tab=chat&doc=doc-1");
  await expect(page.locator("header[aria-label='Active document']")).toContainText("Cell Biology.pdf");
  await page.getByRole("button", { name: "Delete PDF" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete this PDF?" });
  await expect(dialog).toContainText("can't be undone");
  const sent = page.waitForRequest((r) => r.method() === "DELETE" && r.url().endsWith("/documents/doc-1"));
  await dialog.getByRole("button", { name: "Delete PDF" }).click();
  await sent;
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/tab=overview&doc=course-1/);
  await expect(page.locator("header[aria-label='Active document']")).toContainText("Life sciences");
});

test("admin: Test connection shows the reply, or the error with a hint", async ({ page }) => {
  await mockApi(page);
  await page.goto("/account/admin");
  const fast = page.getByRole("button", { name: "Test" }).first();
  await fast.scrollIntoViewIfNeeded();
  await fast.click();
  await expect(page.getByText(/answered in 742 ms/)).toBeVisible();
  await page.goto("/account/settings");
});
