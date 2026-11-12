import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdfjs = vi.hoisted(() => ({ pages: [] as string[][] }));
vi.mock("@/lib/study/pdf", () => ({
  loadPdfJs: async () => ({
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: pdfjs.pages.length,
        getPage: async (n: number) => ({
          getTextContent: async () => ({ items: pdfjs.pages[n - 1].map((str, i, all) => ({ str, hasEOL: i === all.length - 1 })) }),
          cleanup: () => {},
        }),
        destroy: async () => {},
      }),
    }),
  }),
}));

import { PAGES_PER_BATCH, readPdf, sendUpload } from "./upload";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("readPdf", () => {
  it("takes each page's text and the file's fingerprint", async () => {
    pdfjs.pages = [["The cell", "membrane"], ["Mitochondria make ATP"]];
    const r = await readPdf(new File(["%PDF-1.7 hello"], "a.pdf"));
    expect(r.pageCount).toBe(2);
    expect(r.pages).toEqual([{ page: 1, text: "The cell membrane" }, { page: 2, text: "Mitochondria make ATP" }]);
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a scan with no text says so before anything is uploaded", async () => {
    pdfjs.pages = [[" "], [""]];
    await expect(readPdf(new File(["%PDF"], "scan.pdf"))).rejects.toMatchObject({ code: "no_text", action: "reupload" });
  });
});

describe("sendUpload", () => {
  let calls: { method: string; path: string; body: unknown }[];
  beforeEach(() => { calls = []; });

  it("sends the file, then the pages in batches, the last one marked done", async () => {
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname;
      const body = req.method === "POST" ? await req.json() : await req.text();
      calls.push({ method: req.method, path, body });
      return json({ id: "d1", status: path.endsWith("/file") ? "reading" : body.done ? "ready" : "indexing" });
    }));
    const pages = Array.from({ length: PAGES_PER_BATCH + 5 }, (_, i) => ({ page: i + 1, text: `p${i + 1}` }));
    const seen: string[] = [];
    const done = await sendUpload("d1", new File(["%PDF"], "a.pdf"), { pageCount: pages.length, pages, hash: "x", textChars: 99 }, (d) => seen.push(d.status));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["PUT /api/v1/documents/d1/file", "POST /api/v1/documents/d1/pages", "POST /api/v1/documents/d1/pages"]);
    expect((calls[1].body as { pages: unknown[]; done: boolean })).toMatchObject({ done: false });
    expect((calls[1].body as { pages: unknown[] }).pages).toHaveLength(PAGES_PER_BATCH);
    expect((calls[2].body as { done: boolean }).done).toBe(true);
    expect(seen).toEqual(["reading", "indexing", "ready"]);
    expect(done.status).toBe("ready");
  });

  it("tries a batch again when the server is busy, and gives up on a real refusal", async () => {
    vi.useFakeTimers();
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      if (req.method === "PUT") return json({ id: "d1", status: "reading" });
      n++;
      return n === 1 ? json({ error: { code: "embedding_unavailable", message: "busy", action: "retry", details: null } }, 503) : json({ id: "d1", status: "ready" });
    }));
    const p = sendUpload("d1", new File(["%PDF"], "a.pdf"), { pageCount: 1, pages: [{ page: 1, text: "x" }], hash: "x", textChars: 9 }, () => {});
    await vi.advanceTimersByTimeAsync(2000);
    expect((await p).status).toBe("ready");

    vi.stubGlobal("fetch", vi.fn(async (req: Request) => req.method === "PUT"
      ? json({ id: "d1", status: "reading" })
      : json({ error: { code: "upload_state", message: "This upload isn't in progress.", action: "reupload", details: null } }, 409)));
    await expect(sendUpload("d1", new File(["%PDF"], "a.pdf"), { pageCount: 1, pages: [{ page: 1, text: "x" }], hash: "x", textChars: 9 }, () => {}))
      .rejects.toMatchObject({ code: "upload_state" });
  });
});
