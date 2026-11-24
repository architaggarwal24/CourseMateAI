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
  await page.getByLabel("Choose files", { exact: true }).setInputFiles(PDF);                 // the course has loaded: new PDFs join it
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
  const picker = page.getByLabel("Choose files", { exact: true });
  expect(await picker.getAttribute("multiple")).not.toBeNull();
  const bytes = (await import("node:fs")).readFileSync(PDF);
  await picker.setInputFiles([
    { name: "week-1.pdf", mimeType: "application/pdf", buffer: bytes },
    { name: "week-2.pdf", mimeType: "application/pdf", buffer: bytes },
  ]);
  await expect.poll(() => started.length, { timeout: 20_000 }).toBe(2);
  expect(started).toEqual(["week-1.pdf→course-1", "week-2.pdf→course-1"]);
});

// Files stage 2: a PowerPoint is read in the real browser (its own DecompressionStream inflates the slides), only its
// text goes up, and there is no file step.
test("a PowerPoint's slides are read in the browser and sent as pages, with no file upload", async ({ page }) => {
  const { deflateRawSync } = await import("node:zlib");
  const entries: [string, string, boolean][] = [
    ["ppt/slides/slide2.xml", `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Mitochondria make ATP</a:t></a:r></a:p></p:sld>`, true],
    ["ppt/slides/slide1.xml", `<p:sld xmlns:a="a" xmlns:p="p"><a:p><a:r><a:t>Cells are the unit of life</a:t></a:r></a:p></p:sld>`, false],
  ];
  const locals: Buffer[] = [];
  const dirs: Buffer[] = [];
  let offset = 0;
  for (const [name, text, deflated] of entries) {
    const raw = Buffer.from(text);
    const data = deflated ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30 + n.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26); n.copy(local, 30);
    const dir = Buffer.alloc(46 + n.length);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(deflated ? 8 : 0, 10);
    dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(n.length, 28); dir.writeUInt32LE(offset, 42); n.copy(dir, 46);
    locals.push(local, data); dirs.push(dir);
    offset += local.length + data.length;
  }
  const dirBuf = Buffer.concat(dirs);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(offset, 16);
  const pptx = Buffer.concat([...locals, dirBuf, end]);

  await mockApi(page, { signedIn: true, documents: [] });
  const sent: { start?: Record<string, unknown>; file: boolean; pages: { page: number; text: string }[] } = { file: false, pages: [] };
  const base = { id: "deck", filename: "cells.pptx", file_hash: "x", error: null, chunks: 0, embedding_model: "m",
    created_at: "2026-11-05T09:00:00Z", last_used_at: "2026-11-05T09:00:00Z", pdf_available: false };
  await page.route("**/api/v1/upload", async (route) => {
    sent.start = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "received", session_id: "deck", reused: false, document: { ...base, status: "reading" } }) });
  });
  await page.route("**/api/v1/documents/deck/file", async (route) => { sent.file = true; await route.fulfill({ status: 409, body: "{}" }); });
  await page.route("**/api/v1/documents/deck/pages", async (route) => {
    const body = route.request().postDataJSON();
    sent.pages.push(...body.pages);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...base, status: body.done ? "ready" : "indexing", chunks: 2 }) });
  });
  await page.goto("/study?tab=chat");
  expect(await page.getByLabel("Choose files", { exact: true }).getAttribute("accept")).toContain(".pptx");
  await page.getByLabel("Choose files", { exact: true }).setInputFiles({ name: "cells.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: pptx });
  await expect.poll(() => sent.pages.length, { timeout: 20_000 }).toBe(2);
  expect(sent.start).toMatchObject({ filename: "cells.pptx", pages: 2 });
  expect(sent.pages).toEqual([{ page: 1, text: "Slide 1\nCells are the unit of life" }, { page: 2, text: "Slide 2\nMitochondria make ATP" }]);
  expect(sent.file).toBe(false);
});

// Files stage 4: a photo added to a course is shrunk to JPEG in the browser and sent for the AI to read, with no
// file step and no text pages.
test("a photo added to a course goes to the AI to be read, as a JPEG", async ({ page }) => {
  await mockApi(page, { signedIn: true, documents: [] });
  const sent: { start?: Record<string, unknown>; ocr: Record<string, unknown>[]; other: string[] } = { ocr: [], other: [] };
  const base = { id: "photo", filename: "board.png", file_hash: "x", error: null, chunks: 0, embedding_model: "m",
    created_at: "2026-11-05T09:00:00Z", last_used_at: "2026-11-05T09:00:00Z", pdf_available: false };
  await page.route("**/api/v1/upload", async (route) => {
    sent.start = route.request().postDataJSON();
    await route.fulfill({ status: 202, contentType: "application/json",
      body: JSON.stringify({ ok: true, message: "received", session_id: "photo", reused: false, document: { ...base, status: "reading" } }) });
  });
  await page.route(/\/api\/v1\/documents\/photo\/(file|pages)$/, async (route) => { sent.other.push(route.request().url()); await route.fulfill({ status: 409, body: "{}" }); });
  await page.route("**/api/v1/documents/photo/ocr", async (route) => {
    sent.ocr.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...base, status: "ready", chunks: 1 }) });
  });
  await page.goto("/study?tab=chat");
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 3200; c.height = 1200;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, 3200, 1200); g.fillStyle = "#000"; g.font = "120px sans-serif"; g.fillText("Osmosis", 100, 300);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel("Choose files", { exact: true }).setInputFiles({ name: "board.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect.poll(() => sent.ocr.length, { timeout: 20_000 }).toBe(1);
  expect(sent.start).toMatchObject({ filename: "board.png", pages: 1, ocr_pages: 1 });
  expect(sent.ocr[0]).toMatchObject({ page: 1, mime: "image/jpeg", done: true });
  const size = await page.evaluate(async (b64) => {
    const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob());
    return [img.width, img.height];
  }, sent.ocr[0].data as string);
  expect(size).toEqual([1600, 600]);
  expect(sent.other).toEqual([]);
});
