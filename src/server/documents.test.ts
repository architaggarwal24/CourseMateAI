/** @vitest-environment node */
// Documents, search and courses on the Worker (Stage 4.2), end to end on a local D1 + R2, with Workers AI and
// Vectorize stood in by src/server/test/search-fakes.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authRoute from "@/app/api/auth/[...all]/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as deleteAccount from "@/app/api/v1/auth/delete-account/route";
import * as upload from "@/app/api/v1/upload/route";
import * as docs from "@/app/api/v1/documents/route";
import * as doc from "@/app/api/v1/documents/[id]/route";
import * as file from "@/app/api/v1/documents/[id]/file/route";
import * as pages from "@/app/api/v1/documents/[id]/pages/route";
import * as search from "@/app/api/v1/documents/[id]/search/route";
import * as courses from "@/app/api/v1/courses/route";
import * as course from "@/app/api/v1/courses/[id]/route";
import * as progress from "@/app/api/v1/courses/[id]/progress/route";
import * as usage from "@/app/api/v1/account/usage/route";
import { setMailerForTests } from "./context";
import { setEnvForTests } from "./env";
import { setSearchForTests } from "./search";
import { Browser, fakeMailer, json, ORIGIN, SETTINGS } from "./test/auth-helpers";
import { localPlatform, type LocalPlatform } from "./test/platform";
import { fakeEmbedder, fakeVectors } from "./test/search-fakes";

let p: LocalPlatform;
let mail: ReturnType<typeof fakeMailer>;
let vectors: ReturnType<typeof fakeVectors>;
let ip = 10;

beforeEach(async () => {
  p = await localPlatform();
  setEnvForTests(p.env);
  mail = fakeMailer(true);
  setMailerForTests(mail);
  vectors = fakeVectors();
  setSearchForTests({ embedder: fakeEmbedder(), vectors });
  for (const [k, v] of Object.entries(SETTINGS)) vi.stubEnv(k, v as string);
}, 60_000);
afterEach(async () => {
  setEnvForTests(null);
  setMailerForTests(null);
  setSearchForTests(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await p?.dispose();
});

const params = <T,>(v: T) => ({ params: Promise.resolve(v) });

async function person(email: string, username: string): Promise<Browser> {
  const b = new Browser(`198.51.100.${ip++}`);
  await authRoute.POST(b.request("/api/auth/sign-up/email", { body: { email, password: "correct-horse-1", name: username, username } }));
  b.keep(await authRoute.POST(b.request("/api/auth/email-otp/verify-email", { body: { email, otp: mail.lastCode(email) } })));
  return b;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const pdfBytes = (seed: string, size = 2048): Uint8Array<ArrayBuffer> => {
  const b = new Uint8Array(size);
  b.set(new TextEncoder().encode(`%PDF-1.7 ${seed}`));
  return b;
};

const BIOLOGY = [
  { page: 1, text: "Cell biology basics. The cell membrane controls what enters and leaves the cell." },
  { page: 2, text: "Mitochondria make ATP through cellular respiration. Respiration uses glucose and oxygen." },
  { page: 3, text: "Photosynthesis in chloroplasts turns light, water and carbon dioxide into glucose." },
];

/** The browser's whole upload: start, the file, the pages. */
async function uploadPdf(b: Browser, name: string, pageTexts = BIOLOGY, opts: { sessionId?: string; bytes?: Uint8Array<ArrayBuffer> } = {}) {
  const bytes = opts.bytes ?? pdfBytes(name);
  const start = await upload.POST(b.request("/api/v1/upload", {
    body: { filename: name, size: bytes.length, pages: pageTexts.length, file_hash: await sha256(bytes), session_id: opts.sessionId },
  }));
  const started = await json(start);
  if (start.status >= 400 || started.reused) return { start, started, id: started.session_id as string };
  const id = started.session_id as string;
  const put = await file.PUT(new Request(`${ORIGIN}/api/v1/documents/${id}/file`, {
    method: "PUT", headers: { cookie: b.header(), origin: ORIGIN, "content-type": "application/pdf", "content-length": String(bytes.length) },
    body: bytes, duplex: "half",
  } as RequestInit), params({ id }));
  expect(put.status).toBe(200);
  let last: Response | null = null;
  for (let i = 0; i < pageTexts.length; i += 2) {
    last = await pages.POST(b.request(`/api/v1/documents/${id}/pages`, { body: { pages: pageTexts.slice(i, i + 2), done: i + 2 >= pageTexts.length } }), params({ id }));
    expect(last.status).toBe(200);
  }
  return { start, started, id, done: await json(last!) };
}

describe("uploading", () => {
  it("start -> file -> pages: the document is ready, listed, searchable by page", async () => {
    const b = await person("owner@example.com", "boss");
    const { started, id, done } = await uploadPdf(b, "Cell Biology.pdf");
    expect(started).toMatchObject({ ok: true, reused: false, document: { status: "queued", filename: "Cell Biology.pdf" } });
    expect(done).toMatchObject({ id, status: "ready", chunks: 3, pdf_available: true, indexed_pages: 3 });
    expect(vectors.store.size).toBe(3);

    const list = await json(await docs.GET(b.request("/api/v1/documents")));
    expect(list.documents.map((d: { id: string }) => d.id)).toEqual([id]);
    const hits = await json(await search.GET(b.request(`/api/v1/documents/${id}/search?q=${encodeURIComponent("how do mitochondria make ATP")}&k=2`), params({ id })));
    expect(hits.passages[0]).toMatchObject({ page: 2, document: "Cell Biology.pdf" });
    expect(hits.passages[0].text).toMatch(/Mitochondria/);
  });

  it("the same file under the same id is reused; a changed file is checked against its fingerprint", async () => {
    const b = await person("owner@example.com", "boss");
    const { id } = await uploadPdf(b, "Bio.pdf");
    const again = await uploadPdf(b, "Bio.pdf", BIOLOGY, { sessionId: id });
    expect(again.started).toMatchObject({ reused: true, document: { status: "ready" } });

    const start = await json(await upload.POST(b.request("/api/v1/upload", { body: { filename: "x.pdf", size: 2048, pages: 1, file_hash: "a".repeat(64) } })));
    const put = await file.PUT(new Request(`${ORIGIN}/api/v1/documents/${start.session_id}/file`, {
      method: "PUT", headers: { cookie: b.header(), origin: ORIGIN }, body: pdfBytes("other"), duplex: "half",
    } as RequestInit), params({ id: start.session_id }));
    expect(put.status).toBe(400);
    expect((await json(put)).error.message).toMatch(/changed during the upload/);
  });

  it("a PDF with no text fails with the scanned-PDF message", async () => {
    const b = await person("owner@example.com", "boss");
    const { done } = await uploadPdf(b, "Scan.pdf", [{ page: 1, text: "   " }, { page: 2, text: "" }]);
    expect(done).toMatchObject({ status: "failed", chunks: 0 });
    expect(done.error).toMatch(/scanned or image-only/);
  });

  it("an upload left unfinished turns into failed after a while", async () => {
    const b = await person("owner@example.com", "boss");
    const bytes = pdfBytes("half");
    const s = await json(await upload.POST(b.request("/api/v1/upload", { body: { filename: "Half.pdf", size: bytes.length, pages: 2, file_hash: await sha256(bytes) } })));
    await p.env.DB.prepare("UPDATE documents SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ?").bind(s.session_id).run();
    const got = await json(await doc.GET(b.request(`/api/v1/documents/${s.session_id}`), params({ id: s.session_id })));
    expect(got).toMatchObject({ status: "failed", error: expect.stringMatching(/stopped before it finished/) });
  });

  it("checks the plan: Free holds 3 documents of up to 10 MB", async () => {
    const b = await person("free@example.com", "free");
    for (const n of ["a", "b", "c"]) await uploadPdf(b, `${n}.pdf`);
    const fourth = await upload.POST(b.request("/api/v1/upload", { body: { filename: "d.pdf", size: 100, pages: 1, file_hash: "b".repeat(64) } }));
    expect(fourth.status).toBe(403);
    expect((await json(fourth)).error).toMatchObject({ code: "plan_limit", action: "plans", details: { limit: "documents", allowed: 3, upgrade_tier: "scholar" } });
    const u = await json(await usage.GET(b.request("/api/v1/account/usage")));
    expect(u.used.documents).toBe(3);

    const other = await person("free2@example.com", "free2");
    const big = await upload.POST(other.request("/api/v1/upload", { body: { filename: "big.pdf", size: 11 * 1024 * 1024, pages: 1, file_hash: "c".repeat(64) } }));
    expect((await json(big)).error.details).toMatchObject({ limit: "pdf_mb", allowed: 10 });
  });

  it("parallel uploads can't pass the plan's document count (security fix #11)", async () => {
    const b = await person("racer@example.com", "racer");
    for (const n of ["a", "b"]) await uploadPdf(b, `${n}.pdf`);
    const starts = await Promise.all(["1", "2", "3", "4", "5"].map((n) =>
      upload.POST(b.request("/api/v1/upload", { body: { filename: `${n}.pdf`, size: 100, pages: 1, file_hash: n.repeat(64) } }))));
    expect(starts.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    for (const r of starts) if (r.status !== 200) expect((await json(r)).error.code).toBe("plan_limit");
    const u = await json(await usage.GET(b.request("/api/v1/account/usage")));
    expect(u.used.documents).toBeLessThanOrEqual(3);
  });

  it("a new document id from the browser must be a UUID (it goes into the storage key; security fix #15)", async () => {
    const b = await person("ids@example.com", "ids");
    for (const bad of ["../7/secret", "a/b", "x".repeat(300)]) {
      const r = await upload.POST(b.request("/api/v1/upload", { body: { filename: "a.pdf", size: 100, pages: 1, file_hash: "d".repeat(64), session_id: bad } }));
      expect(r.status).toBe(400);
      expect((await json(r)).error.code).toBe("invalid_input");
    }
    const id = crypto.randomUUID();
    const ok = await upload.POST(b.request("/api/v1/upload", { body: { filename: "a.pdf", size: 100, pages: 1, file_hash: "d".repeat(64), session_id: id } }));
    expect((await json(ok)).session_id).toBe(id);
  });

  it("other people's documents look missing", async () => {
    const a = await person("owner@example.com", "boss");
    const { id } = await uploadPdf(a, "Mine.pdf");
    const b = await person("nosy@example.com", "nosy");
    expect((await doc.GET(b.request(`/api/v1/documents/${id}`), params({ id }))).status).toBe(404);
    expect((await doc.DELETE(b.request(`/api/v1/documents/${id}`, { method: "DELETE" }), params({ id }))).status).toBe(404);
  });
});

describe("the PDF viewer's file", () => {
  it("is a Sage feature, served whole or by byte range", async () => {
    const owner = await person("owner@example.com", "boss");
    const bytes = pdfBytes("viewer", 4096);
    const { id } = await uploadPdf(owner, "View.pdf", BIOLOGY, { bytes });
    const whole = await file.GET(owner.request(`/api/v1/documents/${id}/file`), params({ id }));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("application/pdf");
    expect(new Uint8Array(await whole.arrayBuffer()).length).toBe(4096);
    const part = await file.GET(owner.request(`/api/v1/documents/${id}/file`, { headers: { range: "bytes=0-9" } }), params({ id }));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 0-9/4096");
    expect(new TextDecoder().decode(await part.arrayBuffer())).toBe("%PDF-1.7 v");

    const free = await person("free@example.com", "free");
    const mine = await uploadPdf(free, "Free.pdf");
    const locked = await file.GET(free.request(`/api/v1/documents/${mine.id}/file`), params({ id: mine.id }));
    expect((await json(locked)).error).toMatchObject({ code: "feature_locked", details: { required_tier: "sage" } });
  });
});

describe("deleting", () => {
  it("a document takes its PDF, chunks and vectors with it", async () => {
    const b = await person("owner@example.com", "boss");
    const { id } = await uploadPdf(b, "Gone.pdf");
    expect((await doc.DELETE(b.request(`/api/v1/documents/${id}`, { method: "DELETE" }), params({ id }))).status).toBe(200);
    expect(vectors.store.size).toBe(0);
    expect(await p.env.DB.prepare("SELECT COUNT(*) AS n FROM document_chunks").first("n")).toBe(0);
    const keys = await p.env.FILES.list();
    expect(keys.objects).toHaveLength(0);
  });

  it("deleting the account removes every document's files and vectors", async () => {
    const b = await person("leaver@example.com", "leaver");
    await uploadPdf(b, "One.pdf");
    expect((await deleteAccount.DELETE(b.request("/api/v1/auth/delete-account", { method: "DELETE", body: { password: "correct-horse-1" } }))).status).toBe(200);
    expect(vectors.store.size).toBe(0);
    expect((await p.env.FILES.list()).objects).toHaveLength(0);
    expect((await me.GET(b.request("/api/v1/auth/me"))).status).toBe(401);
  });
});

describe("courses", () => {
  const CHEM = [
    { page: 1, text: "Organic chemistry studies carbon compounds such as alkanes and alkenes." },
    { page: 2, text: "Benzene rings are aromatic and very stable carbon structures." },
  ];

  it("are on every plan: Free holds one course (round 7: Study works inside a course)", async () => {
    const b = await person("free@example.com", "free");
    expect((await json(await courses.GET(b.request("/api/v1/courses")))).courses).toEqual([]);
    const first = await courses.POST(b.request("/api/v1/courses", { body: { name: "Biology" } }));
    expect(first.status).toBe(200);
    const second = await courses.POST(b.request("/api/v1/courses", { body: { name: "Chemistry" } }));
    expect((await json(second)).error).toMatchObject({ code: "plan_limit", details: { limit: "courses", allowed: 1 } });
  });

  it("a PDF uploaded inside a course joins it; someone else's course is refused", async () => {
    const b = await person("free@example.com", "free");
    const c = await json(await courses.POST(b.request("/api/v1/courses", { body: { name: "Biology" } })));
    const bytes = pdfBytes("in-course");
    const start = await upload.POST(b.request("/api/v1/upload", { body: { filename: "Cells.pdf", size: bytes.length, pages: 1, file_hash: await sha256(bytes), course_id: c.id } }));
    const started = await json(start);
    expect(started.course_id).toBe(c.id);
    const list = await json(await courses.GET(b.request("/api/v1/courses")));
    expect(list.courses[0].documents.map((d: { id: string }) => d.id)).toEqual([started.session_id]);

    const other = await person("other@example.com", "other");
    const bad = await upload.POST(other.request("/api/v1/upload", { body: { filename: "x.pdf", size: 10, pages: 1, file_hash: "e".repeat(64), course_id: c.id } }));
    expect((await json(bad)).error.code).toBe("course_not_found");
  });

  it("PDFs from before courses were needed are gathered into a first course, once", async () => {
    const b = await person("old@example.com", "oldie");
    const a = await uploadPdf(b, "A.pdf");
    const z = await uploadPdf(b, "B.pdf", BIOLOGY, { bytes: pdfBytes("other") });
    const [one, two] = await Promise.all([courses.GET(b.request("/api/v1/courses")), courses.GET(b.request("/api/v1/courses"))]);
    for (const r of [one, two]) {
      const got = await json(r);
      expect(got.courses).toHaveLength(1);
      expect(got.courses[0]).toMatchObject({ name: "My PDFs" });
      expect(new Set(got.courses[0].documents.map((d: { id: string }) => d.id))).toEqual(new Set([a.id, z.id]));
    }
  });

  it("group documents; the course id works as a document; search hears every relevant document", async () => {
    const b = await person("owner@example.com", "boss");
    const bio = await uploadPdf(b, "Biology.pdf");
    const chem = await uploadPdf(b, "Chemistry.pdf", CHEM);
    const made = await json(await courses.POST(b.request("/api/v1/courses", { body: { name: "  Life   sciences ", document_ids: [bio.id, chem.id] } })));
    expect(made).toMatchObject({ name: "Life sciences", ready: 2, documents: [{ id: bio.id }, { id: chem.id }] });

    const asDoc = await json(await doc.GET(b.request(`/api/v1/documents/${made.id}`), params({ id: made.id })));
    expect(asDoc).toMatchObject({ kind: "course", status: "ready", file_hash: `course:${made.id}`, chunks: 5, documents: [bio.id, chem.id] });

    const hits = await json(await search.GET(b.request(`/api/v1/documents/${made.id}/search?q=${encodeURIComponent("glucose and carbon compounds")}&k=3`), params({ id: made.id })));
    expect(new Set(hits.passages.map((x: { document: string }) => x.document))).toEqual(new Set(["Biology.pdf", "Chemistry.pdf"]));

    const listed = await json(await docs.GET(b.request("/api/v1/documents")));
    expect(listed.documents.every((d: { pinned: boolean }) => d.pinned)).toBe(true);

    const reordered = await json(await course.PUT(b.request(`/api/v1/courses/${made.id}`, { method: "PUT", body: { document_ids: [chem.id] } }), params({ id: made.id })));
    expect(reordered.documents.map((d: { id: string }) => d.id)).toEqual([chem.id]);
    const prog = await json(await progress.GET(b.request(`/api/v1/courses/${made.id}/progress`), params({ id: made.id })));
    expect(prog).toMatchObject({ course_id: made.id, mastery: 0, documents: [{ id: chem.id }] });

    expect((await course.DELETE(b.request(`/api/v1/courses/${made.id}`, { method: "DELETE" }), params({ id: made.id }))).status).toBe(200);
    expect((await json(await docs.GET(b.request("/api/v1/documents")))).documents).toHaveLength(2);    // the documents stay
  });

  it("only take the user's own documents, need a name, and count against the plan", async () => {
    const owner = await person("owner@example.com", "boss");
    const other = await person("other@example.com", "other");
    const theirs = await uploadPdf(other, "Theirs.pdf");
    const r = await courses.POST(owner.request("/api/v1/courses", { body: { name: "X", document_ids: [theirs.id] } }));
    expect((await json(r)).error.code).toBe("document_not_found");
    expect((await json(await courses.POST(owner.request("/api/v1/courses", { body: { name: "   " } })))).error.details.field).toBe("name");
    const u = await json(await usage.GET(owner.request("/api/v1/account/usage")));
    expect(u.used.courses).toBe(0);
  });
});
