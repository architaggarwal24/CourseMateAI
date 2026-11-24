/** @vitest-environment node */
// Scanned pages and photos read by the AI (Files stage 4): a daily cap per plan taken one page at a time, a model
// that can see (never the free text-only one), the money budgets, and the text indexed like a PDF page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as upload from "@/app/api/v1/upload/route";
import * as ocr from "@/app/api/v1/documents/[id]/ocr/route";
import * as usage from "@/app/api/v1/account/usage/route";
import { setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { setSearchForTests } from "../search";
import { setLlmFactoryForTests } from "../ai/run";
import { getDb } from "../db";
import { DEFAULT_BUDGETS, saveBudgets } from "../ai/budget";
import { fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { AI_ENV, fakeLlms } from "../test/ai-fakes";
import { person } from "../test/flows";
import { OCR_PAGES_DAY } from "./ocr-limits";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let llm: ReturnType<typeof fakeLlms>;

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  setSearchForTests({ embedder: fakeEmbedder(), vectors: fakeVectors() });
  for (const [k, v] of Object.entries({ ...SETTINGS, ...AI_ENV })) vi.stubEnv(k, v as string);
  llm = fakeLlms({ "*": "Chapter 2: Cells\\nThe cell membrane controls what enters and leaves the cell." });
  setLlmFactoryForTests(llm.factory);
}, 60_000);
afterEach(async () => {
  setEnvForTests(null); setMailerForTests(null); setSearchForTests(null); setLlmFactoryForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

const params = <T,>(v: T) => ({ params: Promise.resolve(v) });
const PAGE = { mime: "image/jpeg", data: "aGVsbG8=" };
const hash = (n: number) => n.toString(16).padStart(64, "0");
type B = Awaited<ReturnType<typeof person>>;
const start = async (b: B, filename: string, pages: number, ocrPages?: number, n = 1) =>
  upload.POST(b.request("/api/v1/upload", { body: { filename, size: 5000, pages, file_hash: hash(n), ...(ocrPages === undefined ? {} : { ocr_pages: ocrPages }) } }));
const read = (b: B, id: string, page: number, done: boolean) =>
  ocr.POST(b.request(`/api/v1/documents/${id}/ocr`, { body: { page, ...PAGE, done } }), params({ id }));
const ocrUsed = async (email: string) => (await p.env.DB.prepare(
  "SELECT u.ocr_pages AS n, u.ai_calls AS calls FROM usage_daily u JOIN user ON user.id = u.user_id WHERE user.email = ?").bind(email).first<{ n: number; calls: number }>());

describe("reading scans and photos", () => {
  it("a photo: no file step, read by a model that can see, indexed and ready; a page off the plan's AI calls", async () => {
    const b = await person(mail, "free@example.com", "free");
    const s = await json(await start(b, "board.jpg", 1));
    expect(s.document).toMatchObject({ status: "reading", filename: "board.jpg" });
    const done = await json(await read(b, s.session_id, 1, true));
    expect(done).toMatchObject({ status: "ready", chunks: 1 });
    const call = llm.calls.at(-1)!;
    expect(call.target).toBe("gemini:flash-lite");                              // small job: the cheapest that can see
    expect(call.messages.at(-1)!.images).toEqual([PAGE]);
    expect(call.messages[0].content).toMatch(/Write out ALL readable text/);
    expect(await ocrUsed("free@example.com")).toEqual({ n: 1, calls: 0 });
    const u = await json(await usage.GET(b.request("/api/v1/account/usage")));
    expect(u.ocr).toMatchObject({ used: 1, allowed: OCR_PAGES_DAY.apprentice });
  });

  it("a scan bigger than today's room is refused before anything is spent; the cap holds page by page", async () => {
    const b = await person(mail, "free@example.com", "free");
    const big = await start(b, "chapter.pdf", 30, 30);
    expect(big.status).toBe(429);
    expect((await json(big)).error).toMatchObject({ code: "plan_limit", details: { limit: "ocr_pages_day", allowed: 10, needed: 30 } });
    expect((await json(await start(b, "x.pdf", 3, 4, 2))).error.code).toBe("invalid_input");   // more scanned pages than pages
    const s = await json(await start(b, "notes.jpg", 1, undefined, 3));
    await p.env.DB.prepare("UPDATE usage_daily SET ocr_pages = 10").run();
    await p.env.DB.prepare("INSERT OR IGNORE INTO usage_daily (user_id, day, ai_calls, tokens_in, tokens_out, ocr_pages) SELECT id, ?, 0, 0, 0, 10 FROM user WHERE email = ?")
      .bind(new Date().toISOString().slice(0, 10), "free@example.com").run();
    const over = await read(b, s.session_id, 1, true);
    expect(over.status).toBe(429);
    expect((await json(over)).error.details).toMatchObject({ limit: "ocr_pages_day", allowed: 10 });
    expect((await ocrUsed("free@example.com"))!.n).toBe(10);
  });

  it("a page no model managed is given back; a blank page is read as empty; a bad picture is refused", async () => {
    const b = await person(mail, "free@example.com", "free");
    const s = await json(await start(b, "scan.pdf", 2, 2));
    await p.env.DB.prepare("UPDATE documents SET status = 'reading', pdf_stored = 1 WHERE id = ?").bind(s.session_id).run();   // its file is in
    setLlmFactoryForTests(fakeLlms({ "*": new Error("down") }).factory);
    expect((await read(b, s.session_id, 1, false)).status).toBe(503);
    expect(await ocrUsed("free@example.com")).toMatchObject({ n: 0 });
    setLlmFactoryForTests(fakeLlms({ "*": "NO_TEXT" }).factory);
    expect(await json(await read(b, s.session_id, 1, false))).toMatchObject({ status: "indexing", chunks: 0 });
    const bad = await ocr.POST(b.request(`/api/v1/documents/${s.session_id}/ocr`, { body: { page: 2, mime: "image/gif", data: "aGk=", done: true } }), params({ id: s.session_id }));
    expect(bad.status).toBe(400);
    expect((await ocr.POST(b.request(`/api/v1/documents/${s.session_id}/ocr`, { body: { page: 9, ...PAGE, done: true } }), params({ id: s.session_id }))).status).toBe(400);
  });

  it("past the money budget a scan isn't read by a model that can't see: a clear 'not today' instead", async () => {
    const b = await person(mail, "free@example.com", "free");
    const s = await json(await start(b, "photo.png", 1));
    await saveBudgets(getDb(p.env.DB), { ...DEFAULT_BUDGETS, plan: { ...DEFAULT_BUDGETS.plan, apprentice: 0 } });
    const res = await read(b, s.session_id, 1, true);
    expect(res.status).toBe(429);
    expect((await json(res)).error.code).toBe("budget_images");
    expect(llm.calls.map((c) => c.target)).not.toContain("workers-ai:@cf/google/gemma-4-26b-a4b-it");
    expect((await ocrUsed("free@example.com"))!.n).toBe(0);                        // given back
  });

  it("someone else's document can't be read into", async () => {
    const a = await person(mail, "a@example.com", "aaa");
    const b = await person(mail, "b@example.com", "bbb");
    const s = await json(await start(a, "mine.jpg", 1));
    expect((await read(b, s.session_id, 1, true)).status).toBe(404);
  });
});
