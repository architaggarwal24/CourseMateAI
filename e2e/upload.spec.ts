import { test, expect } from "@playwright/test";
import { join } from "node:path";

import { mockApi } from "./fixtures/api";

const PDF = join(__dirname, "fixtures", "cell-biology.pdf");

// Stage 4.2: the browser reads the PDF itself (pdf.js), so this runs the real reader on a real PDF.
test("uploading reads each page's text in the browser and sends it in batches", async ({ page }) => {
  await mockApi(page, { signedIn: true, documents: [] });
  const sent: { start?: Record<string, unknown>; file?: number; pages: { pages: { page: number; text: string }[]; done: boolean }[] } = { pages: [] };
  const base = { id: "new-doc", filename: "cell-biology.pdf", file_hash: "x", error: null, chunks: 0, embedding_model: "m",
    created_at: "2026-11-05T09:00:00Z", last_used_at: "2026-11-05T09:00:00Z", pdf_available: false };
  await page.route("**/api/v1/upload", async (route) => {
    sent.start = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "received", session_id: "new-doc", reused: false, document: { ...base, status: "queued" } }) });
  });
  await page.route("**/api/v1/documents/new-doc/file", async (route) => {
    sent.file = route.request().postDataBuffer()?.length ?? 0;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...base, status: "reading", pdf_available: true }) });
  });
  await page.route("**/api/v1/documents/new-doc/pages", async (route) => {
    const body = route.request().postDataJSON();
    sent.pages.push(body);
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ...base, status: body.done ? "ready" : "indexing", chunks: 3, pdf_available: true }) });
  });

  await page.goto("/study?tab=chat");
  await page.getByLabel("Choose PDFs").setInputFiles(PDF);                 // the course has loaded: new PDFs join it
  await expect.poll(() => sent.pages.some((b) => b.done), { timeout: 20_000 }).toBe(true);

  expect(sent.start).toMatchObject({ filename: "cell-biology.pdf", pages: expect.any(Number), course_id: "course-1" });   // it joins the course on screen
  expect(String(sent.start?.file_hash)).toMatch(/^[0-9a-f]{64}$/);
  expect(sent.file).toBeGreaterThan(100);
  const pages = sent.pages.flatMap((b) => b.pages);
  expect(pages[0].page).toBe(1);
  expect(pages.map((p) => p.text).join(" ")).toMatch(/Cells are the basic unit of life/);
});

// Several PDFs picked at once go into the course one after another.
test("a course takes several PDFs from one pick", async ({ page }) => {
  await mockApi(page, { signedIn: true, documents: [] });
  const started: string[] = [];
  await page.route("**/api/v1/upload", async (route) => {
    const body = route.request().postDataJSON();
    const id = `doc-${started.length + 1}`;
    started.push(`${body.filename}→${body.course_id}`);
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, message: "received", session_id: id, reused: false,
      document: { id, filename: body.filename, file_hash: "x", error: null, chunks: 0, embedding_model: "m", status: "queued",
        created_at: "2026-11-05T09:00:00Z", last_used_at: "2026-11-05T09:00:00Z", pdf_available: false } }) });
  });
  await page.route(/\/api\/v1\/documents\/doc-\d\/(file|pages)$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto("/study?tab=overview&doc=course-1");
  const picker = page.getByLabel("Choose PDFs");
  expect(await picker.getAttribute("multiple")).not.toBeNull();
  const bytes = (await import("node:fs")).readFileSync(PDF);
  await picker.setInputFiles([
    { name: "week-1.pdf", mimeType: "application/pdf", buffer: bytes },
    { name: "week-2.pdf", mimeType: "application/pdf", buffer: bytes },
  ]);
  await expect.poll(() => started.length, { timeout: 20_000 }).toBe(2);
  expect(started).toEqual(["week-1.pdf→course-1", "week-2.pdf→course-1"]);
});
