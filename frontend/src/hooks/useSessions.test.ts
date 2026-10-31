import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { user_id: 1 } }) }));

import { stopDocumentPolling, useSessionStore } from "@/hooks/useSessions";
import type { DocumentInfo } from "@/lib/api";

const doc = (status: DocumentInfo["status"], extra: Partial<DocumentInfo> = {}): DocumentInfo => ({
  id: "s1", filename: "notes.pdf", file_hash: "h", status, error: null, chunks: null,
  embedding_model: null, created_at: "t", last_used_at: "t", ...extra,
});
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const gone = () => json(404, { error: { code: "document_not_found", message: "That document couldn't be found.", action: null, details: null } });

type Reply = Response | Error;
/** fetch stub: GET /documents/s1 pops the next scripted reply; /upload and /documents answer from `routes`. */
function serve(opts: { status?: Reply[]; list?: DocumentInfo[]; upload?: DocumentInfo }) {
  const statusReplies = [...(opts.status ?? [])];
  const spy = vi.fn(async (req: Request) => {
    const { pathname } = new URL(req.url);
    if (pathname === "/api/v1/upload") return json(202, { ok: true, message: "ok", session_id: "s1", reused: false, document: opts.upload });
    if (pathname === "/api/v1/documents") return json(200, { documents: opts.list ?? [] });
    if (pathname === "/api/v1/documents/s1") {
      const next = statusReplies.shift() ?? statusReplies[0];
      if (next instanceof Error) throw next;
      return next!.clone();
    }
    throw new Error(`unexpected ${pathname}`);
  });
  vi.stubGlobal("fetch", spy);
  const statusCalls = () => spy.mock.calls.filter(([r]) => new URL(r.url).pathname === "/api/v1/documents/s1").length;
  return { spy, statusCalls };
}
const tick = (ms = 1000) => vi.advanceTimersByTimeAsync(ms);
const store = () => useSessionStore.getState();
const pdf = () => new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.useFakeTimers();
  store().clearDocuments();
});
afterEach(() => {
  stopDocumentPolling();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("document polling in the sessions store", () => {
  it("uploads at once, then follows queued → reading → indexing → ready and stops", async () => {
    const { statusCalls } = serve({
      upload: doc("queued"),
      status: [json(200, doc("reading")), json(200, doc("indexing")), json(200, doc("ready", { chunks: 12 }))],
    });
    const uploaded = await store().uploadDocument("s1", pdf());
    expect(uploaded.status).toBe("queued");
    expect(store().documents.s1.status).toBe("queued");
    expect(statusCalls()).toBe(0);                         // nothing is polled until the interval elapses

    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { await tick(); seen.push(store().documents.s1.status); }
    expect(seen).toEqual(["reading", "indexing", "ready"]);
    expect(store().documents.s1.chunks).toBe(12);

    await tick(30_000);                                    // finished: no more requests
    expect(statusCalls()).toBe(3);
  });

  it("follows a document the server is still processing when the page loads (after a reload or restart)", async () => {
    const { statusCalls } = serve({ list: [doc("indexing")], status: [json(200, doc("ready"))] });
    await store().loadDocuments("1");
    expect(store().documentsLoaded).toBe(true);
    expect(store().documents.s1.status).toBe("indexing");
    await tick();
    expect(store().documents.s1.status).toBe("ready");
    await tick(10_000);
    expect(statusCalls()).toBe(1);
  });

  it("does not poll documents that are already finished", async () => {
    const { spy } = serve({ list: [doc("ready"), doc("failed", { id: "s2", error: "bad" })] });
    await store().loadDocuments("1");
    await tick(20_000);
    expect(spy).toHaveBeenCalledTimes(1);                  // just the list
  });

  it("stops on failure and keeps the server's message", async () => {
    const { statusCalls } = serve({ upload: doc("queued"), status: [json(200, doc("failed", { error: "No readable text was found." }))] });
    await store().uploadDocument("s1", pdf());
    await tick();
    expect(store().documents.s1).toMatchObject({ status: "failed", error: "No readable text was found." });
    await tick(10_000);
    expect(statusCalls()).toBe(1);
  });

  it("drops a document the server no longer has", async () => {
    serve({ upload: doc("queued"), status: [gone()] });
    await store().uploadDocument("s1", pdf());
    await tick();
    expect(store().documents.s1).toBeUndefined();
  });

  it("keeps going through a transient network error", async () => {
    const { statusCalls } = serve({ upload: doc("queued"), status: [new TypeError("network down"), json(200, doc("ready"))] });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await store().uploadDocument("s1", pdf());
    await tick();
    expect(store().documents.s1.status).toBe("queued");   // last known state is kept
    await tick();
    expect(store().documents.s1.status).toBe("ready");
    expect(statusCalls()).toBe(2);
  });

  it("uploading the same file again does not start a second poller", async () => {
    const { statusCalls } = serve({ upload: doc("queued"), status: [json(200, doc("ready"))] });
    await store().uploadDocument("s1", pdf());
    await store().uploadDocument("s1", pdf());
    await tick();
    expect(statusCalls()).toBe(1);
  });

  it("forgets one account's documents when another logs in", async () => {
    serve({ list: [doc("ready")] });
    await store().loadDocuments("1");
    expect(store().documents.s1).toBeDefined();
    serve({ list: [] });
    await store().loadDocuments("2");
    expect(store().documents).toEqual({});
    expect(store().documentsOwner).toBe("2");
  });
});
