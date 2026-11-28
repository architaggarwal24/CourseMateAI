/** @vitest-environment node */
// Security audit run 2: two overlapping page batches for one document. Each batch claims its chunk numbers before
// embedding, so a batch that lost the claim is refused having written nothing, and deleting the document for good
// leaves no search vectors behind (they used to stay, uncounted, past the plan's ceiling). Two requests that read
// the same count can't both claim it: the claim is one compare-and-set on documents.chunks.
// Fake embedder and in-memory Vectorize; a free test account; one fixed interleaving.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as upload from "@/app/api/v1/upload/route";
import * as pagesRoute from "@/app/api/v1/documents/[id]/pages/route";
import * as docRoute from "@/app/api/v1/documents/[id]/route";
import * as trashOne from "@/app/api/v1/trash/[id]/route";
import { setMailerForTests } from "../context";
import { setEnvForTests } from "../env";
import { setSearchForTests } from "../search";
import { type Browser, fakeMailer, json, SETTINGS } from "../test/auth-helpers";
import { localPlatform, type LocalPlatform } from "../test/platform";
import { fakeEmbedder, fakeVectors } from "../test/search-fakes";
import { params, person } from "../test/flows";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let vectors: ReturnType<typeof fakeVectors>;
let embedded = 0;
// the big batch waits inside embed() until the small batch has finished (one fixed interleaving)
let bigReached: () => void = () => {};
let releaseBig: () => void = () => {};

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  const base = fakeEmbedder();
  vectors = fakeVectors();
  setSearchForTests({
    embedder: {
      model: base.model,
      async embed(texts: string[]) {
        embedded += texts.length;
        if (texts.length > 100) { bigReached(); await new Promise<void>((r) => { releaseBig = r; }); }
        return base.embed(texts);
      },
    },
    vectors,
  });
  for (const [k, v] of Object.entries(SETTINGS)) vi.stubEnv(k, v as string);
}, 60_000);
afterEach(async () => {
  setEnvForTests(null); setMailerForTests(null); setSearchForTests(null);
  vi.unstubAllEnvs();
  await p?.dispose();
});

const post = (b: Browser, path: string, body: unknown) => b.request(path, { body });
const words = (seed: number) => Array.from({ length: 6000 }, (_, i) => `w${seed}x${i % 997}`).join(" ").slice(0, 40_000);
const docVectors = (id: string) => [...vectors.store.keys()].filter((k) => k.startsWith(`${id}:`)).length;
const allVectors = () => vectors.store.size;

async function cycle(b: Browser, k: number) {
  const started = await json(await upload.POST(post(b, "/api/v1/upload", { filename: `notes-${k}.txt`, size: 10, pages: 41, file_hash: `${k}`.padStart(64, "a") })));
  const id = started.session_id as string;
  const big = Array.from({ length: 40 }, (_, i) => ({ page: i + 2, text: words(k * 100 + i) }));
  const reached = new Promise<void>((r) => { bigReached = r; });
  const bigReq = pagesRoute.POST(post(b, `/api/v1/documents/${id}/pages`, { pages: big }), params({ id }));
  await reached;                                                                   // big has read chunks = 0, is embedding
  const small = await pagesRoute.POST(post(b, `/api/v1/documents/${id}/pages`, { pages: [{ page: 1, text: "one short page" }], done: true }), params({ id }));
  releaseBig();
  const bigRes = await bigReq;
  const row = await p.env.DB.prepare("SELECT status, chunks, indexed_pages FROM documents WHERE id = ?").bind(id).first<{ status: string; chunks: number; indexed_pages: number }>();
  const live = docVectors(id);
  const del = await docRoute.DELETE(b.request(`/api/v1/documents/${id}`, { method: "DELETE" }), params({ id }));
  const forever = await trashOne.DELETE(b.request(`/api/v1/trash/${id}`, { method: "DELETE" }), params({ id }));
  const left = docVectors(id);
  const d1 = await p.env.DB.prepare("SELECT (SELECT count(*) FROM document_chunks WHERE document_id = ?1) AS chunks, (SELECT count(*) FROM trash_chunks WHERE document_id = ?1) AS trash, (SELECT count(*) FROM documents WHERE id = ?1) AS docs").bind(id).first();
  const line = { cycle: k, small: small.status, big: bigRes.status, big_error: (await json(bigRes)).error?.code, row, vectors_while_live: live,
    delete: del.status, delete_forever: forever.status, vectors_left_after_delete_forever: left, d1_after: d1, store_total: allVectors() };
  console.log("[race]", JSON.stringify(line));
  return line;
}

describe("overlapping page batches", () => {
  it("every vector written lies inside the document's counted range, so delete-forever leaves none", async () => {
    const b = await person(mail, "free@example.com", "free");
    for (let k = 1; k <= 2; k++) {
      const l = await cycle(b, k);
      expect(l.big).toBe(200);
      expect(l.small).toBe(200);                                     // it claimed the range after the big batch's
      expect(l.row?.chunks).toBe(l.vectors_while_live);
      expect(l.delete_forever).toBe(200);
      expect(l.vectors_left_after_delete_forever).toBe(0);
    }
    expect(allVectors()).toBe(0);
  }, 200_000);

  it("a batch whose embedding fails gives its place back", async () => {
    const b = await person(mail, "undo@example.com", "undo");
    const started = await json(await upload.POST(post(b, "/api/v1/upload", { filename: "u.txt", size: 10, pages: 2, file_hash: "d".repeat(64) })));
    const id = started.session_id as string;
    const upsert = vectors.upsert;
    vectors.upsert = async () => { throw new Error("index down"); };
    const failed = await pagesRoute.POST(post(b, `/api/v1/documents/${id}/pages`, { pages: [{ page: 1, text: "first page text" }] }), params({ id }));
    vectors.upsert = upsert;
    expect(failed.status).toBe(503);
    expect(await p.env.DB.prepare("SELECT chunks, indexed_pages AS pages FROM documents WHERE id = ?").bind(id).first()).toMatchObject({ chunks: 0, pages: 0 });
    const again = await pagesRoute.POST(post(b, `/api/v1/documents/${id}/pages`, { pages: [{ page: 1, text: "first page text" }, { page: 2, text: "second" }], done: true }), params({ id }));
    expect(again.status).toBe(200);
    expect((await json(again)).status).toBe("ready");
  }, 120_000);
});
