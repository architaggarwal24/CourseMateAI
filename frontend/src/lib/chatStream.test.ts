import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { askChat, readSse, streamChat } from "@/lib/chatStream";
import { frame, json, sseBody, urlOf } from "@/test/sse";

const ask = (over: Partial<Parameters<typeof askChat>[0]> = {}) =>
  askChat({ question: "What is ATP?", sessionId: "s1", history: [], ...over });

const FINAL = { mode: "chat", sources: ["bio.pdf · p.4", "bio.pdf · p.9"], blocked: false, needs_clarification: false, rewards: null };
const PLAIN = { mode: "chat", content: "ATP is the energy currency.", sources: ["bio.pdf · p.4"], rewards: null };

const sse = (body: ReturnType<typeof sseBody>) => new Response(body.stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });

let calls: string[];
function serve(streamReply: () => Response | Promise<Response>, plain: () => Response = () => json(200, PLAIN)) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(urlOf(input)).pathname;
    calls.push(url);
    if (url.endsWith("/chat/stream")) return streamReply();
    if (url.endsWith("/chat")) return plain();
    throw new Error(`unexpected ${url}`);
  }));
}
beforeEach(() => { vi.stubGlobal("window", { location: { href: "/" }, dispatchEvent: vi.fn() }); });
afterEach(() => vi.unstubAllGlobals());

describe("readSse", () => {
  it("yields frames however the network chunked them (mid-frame, mid-character, CRLF)", async () => {
    const text = frame("token", { text: "Grüße ✓" }) + frame("sources", FINAL);
    const bytes = new TextEncoder().encode(text.replace(/\n/g, "\r\n"));
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); },
    });
    const frames = [];
    for await (const f of readSse(stream)) frames.push(f);
    expect(frames).toEqual([{ event: "token", data: { text: "Grüße ✓" } }, { event: "sources", data: FINAL }]);
  });

  it("skips comments and malformed frames", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(`: keep-alive\n\nevent: token\ndata: {nope\n\n${frame("token", { text: "ok" })}`)); c.close(); },
    });
    const frames = [];
    for await (const f of readSse(stream)) frames.push(f);
    expect(frames).toEqual([{ event: "token", data: { text: "ok" } }]);
  });
});

describe("streamChat", () => {
  it("hands over each piece as it arrives and the final sources", async () => {
    const body = sseBody();
    serve(() => sse(body));
    const seen: string[] = [];
    const done = streamChat({ question: "q", sessionId: "s1", history: [], onToken: (t) => seen.push(t) });

    body.push(frame("token", { text: "ATP " }));
    await vi.waitFor(() => expect(seen).toEqual(["ATP "]));          // visible before the answer is finished
    body.push(frame("token", { text: "is energy." }));
    body.push(frame("sources", FINAL));
    body.close();

    expect(await done).toEqual({
      content: "ATP is energy.", sources: ["bio.pdf · p.4", "bio.pdf · p.9"], blocked: false, needsClarification: false, rewards: undefined,
    });
  });

  it("reports the not-found answer as blocked", async () => {
    const body = sseBody();
    serve(() => sse(body));
    const done = streamChat({ question: "q", sessionId: "s1", history: [] });
    body.push(frame("token", { text: 'I cannot find "q" in the uploaded PDF.' }) + frame("sources", { ...FINAL, sources: [], blocked: true }));
    body.close();
    expect(await done).toMatchObject({ blocked: true, sources: [] });
  });
});

describe("askChat: the plain endpoint is the fallback", () => {
  it("falls back when the server errors before streaming", async () => {
    serve(() => json(500, { error: { code: "internal", message: "boom", action: "retry", details: null } }));
    const onFallback = vi.fn();
    expect(await ask({ onFallback })).toMatchObject({ content: "ATP is the energy currency.", sources: ["bio.pdf · p.4"] });
    expect(calls).toEqual(["/api/v1/chat/stream", "/api/v1/chat"]);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("falls back when the connection fails", async () => {
    serve(() => { throw new TypeError("network down"); });
    expect((await ask()).content).toBe("ATP is the energy currency.");
  });

  it("falls back when the stream dies midway, telling the screen to drop the partial text", async () => {
    const body = sseBody();
    serve(() => sse(body));
    const shown: string[] = [];
    const done = ask({ onToken: (t) => shown.push(t), onFallback: () => shown.splice(0) });
    body.push(frame("token", { text: "ATP is" }));
    await vi.waitFor(() => expect(shown).toEqual(["ATP is"]));
    body.push(frame("error", { error: { code: "ai_request_failed", message: "The AI request failed.", action: "retry", details: null } }));
    body.close();
    expect((await done).content).toBe("ATP is the energy currency.");
    expect(shown).toEqual([]);
  });

  it("falls back when the stream ends without its final event", async () => {
    const body = sseBody();
    serve(() => sse(body));
    const done = ask();
    body.push(frame("token", { text: "partial" }));
    body.close();
    expect((await done).content).toBe("ATP is the energy currency.");
  });

  it("does NOT fall back on an answer the server gave on purpose", async () => {
    for (const [status, code] of [[400, "session_expired"], [404, "document_not_found"], [429, "provider_quota"]] as const) {
      serve(() => json(status, { error: { code, message: "no", action: null, details: null } }));
      await expect(ask()).rejects.toBeInstanceOf(ApiError);
      expect(calls).toEqual(["/api/v1/chat/stream"]);
    }
  });

  it("a quota error in the middle of the stream is not retried either", async () => {
    const body = sseBody();
    serve(() => sse(body));
    const done = ask();
    body.push(frame("token", { text: "x" }) + frame("error", { error: { code: "provider_quota", message: "quota", action: "settings", details: {} } }));
    body.close();
    await expect(done).rejects.toMatchObject({ code: "provider_quota" });
    expect(calls).toEqual(["/api/v1/chat/stream"]);
  });

  it("cancelling rejects with an AbortError, closes the stream and does not fall back", async () => {
    const body = sseBody();
    calls = [];
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new URL(urlOf(input)).pathname);
      init?.signal?.addEventListener("abort", () => body.fail(new DOMException("Aborted", "AbortError")));
      return sse(body);
    }));
    const done = ask({ signal: controller.signal });
    body.push(frame("token", { text: "ATP" }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toEqual(["/api/v1/chat/stream"]);
  });
});
