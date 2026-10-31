import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  apiErrorMessage,
  chatQuestion,
  fetchDocument,
  fetchDocuments,
  fetchHistory,
  fetchSessionHistory,
  fetchShop,
  parseApiError,
  rawApi,
  uploadPDF,
} from "@/lib/api";

// Shape of every backend error body (backend/errors.py)
const body = (code: string, message: string, action: string | null = null, details: object | null = null) => ({
  error: { code, message, action, details },
});

/** Stub global fetch with a real Response; every call gets a fresh one. Returns the spy so tests can inspect requests. */
function mockFetch(status: number, json?: unknown) {
  const spy = vi.fn(async (_req: Request) =>
    json === undefined
      ? new Response("<html>Bad gateway</html>", { status, headers: { "Content-Type": "text/html" } })
      : new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

let fakeWindow: { location: { href: string }; dispatchEvent: ReturnType<typeof vi.fn> };

beforeEach(() => {
  fakeWindow = { location: { href: "/" }, dispatchEvent: vi.fn() };
  vi.stubGlobal("window", fakeWindow);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseApiError / apiErrorMessage", () => {
  it("reads code, message, action and details from the error contract", () => {
    const e = parseApiError(422, body("validation_error", "Some fields are invalid.", null, { fields: [{ field: "question" }] }));
    expect(e).toBeInstanceOf(ApiError);
    expect([e.status, e.code, e.message, e.action]).toEqual([422, "validation_error", "Some fields are invalid.", null]);
    expect(e.details).toEqual({ fields: [{ field: "question" }] });
  });

  it("exposes quota extras and drops unknown actions", () => {
    const q = parseApiError(429, body("provider_quota", "Quota hit.", "settings", { usage_url: "https://u", provider: "gemini" }));
    expect([q.code, q.usageUrl, q.provider, q.action]).toEqual(["provider_quota", "https://u", "gemini", "settings"]);
    expect(parseApiError(400, body("x", "m", "explode")).action).toBeNull();
  });

  it("falls back when the body is missing or is not in the contract shape", () => {
    expect(parseApiError(502, null).message).toBe("Request failed with status 502");
    expect(parseApiError(502, { detail: "old shape" }).code).toBe("unknown");
    expect(apiErrorMessage(body("x", "Use this."), "fallback")).toBe("Use this.");
    expect(apiErrorMessage({ ok: false, reason: "r" }, "fallback")).toBe("fallback");
    expect(apiErrorMessage(null, "fallback")).toBe("fallback");
  });
});

describe("apiFetch error handling (through chatQuestion)", () => {
  it("401 with action=relogin redirects to /login", async () => {
    mockFetch(401, body("unauthenticated", "Please log in to continue.", "relogin"));
    await expect(chatQuestion("q", "s")).rejects.toMatchObject({
      message: "Session expired. Please log in again.", action: "relogin", status: 401,
    });
    expect(fakeWindow.location.href).toBe("/login");
  });

  it("a 401 that is not a login problem does not redirect", async () => {
    mockFetch(401, body("wrong_password", "Your current password is incorrect."));
    await expect(chatQuestion("q", "s")).rejects.toMatchObject({ code: "wrong_password" });
    expect(fakeWindow.location.href).toBe("/");
  });

  it("provider_quota rejects with its usage link and provider, and raises no global event", async () => {
    mockFetch(429, body("provider_quota", "You have exceeded your API quota for Google Gemini.", "settings",
      { usage_url: "https://aistudio.google.com/usage", provider: "gemini" }));
    await expect(chatQuestion("q", "s")).rejects.toMatchObject({
      code: "provider_quota", usageUrl: "https://aistudio.google.com/usage", provider: "gemini",
    });
    expect(fakeWindow.dispatchEvent).not.toHaveBeenCalled();
  });

  it("rate_limited carries its wait: details.retry_after_seconds, else the Retry-After header", async () => {
    mockFetch(429, body("rate_limited", "Too many requests.", "retry", { retry_after_seconds: 60 }));
    await expect(chatQuestion("q", "s")).rejects.toMatchObject({ code: "rate_limited", action: "retry", retryAfter: 60 });
    expect(fakeWindow.dispatchEvent).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body("rate_limited", "Slow down.", "retry")),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "12" } })));
    await expect(chatQuestion("q", "s")).rejects.toMatchObject({ code: "rate_limited", retryAfter: 12 });
  });

  it("a body-less 429 is an ApiError with no wait given", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
    await expect(chatQuestion("q", "s")).rejects.toMatchObject({ status: 429, code: "unknown", retryAfter: null });
  });

  it("other errors carry the server's message, code and action", async () => {
    mockFetch(400, body("session_expired", "Your document session has expired. Please upload your PDF again.", "reupload"));
    await expect(chatQuestion("q", "s")).rejects.toMatchObject({
      message: "Your document session has expired. Please upload your PDF again.",
      code: "session_expired", action: "reupload", status: 400,
    });
    // the Study workspace is told that the document is gone (and re-checks it); nothing else is raised
    expect(fakeWindow.dispatchEvent).toHaveBeenCalledTimes(1);
    expect((fakeWindow.dispatchEvent.mock.calls[0][0] as CustomEvent).type).toBe("cmai:document-gone");
    expect(fakeWindow.location.href).toBe("/");
  });

  it("an error that is not about the document does not raise the document-gone event", async () => {
    mockFetch(400, body("validation_error", "Bad input.", null));
    await expect(chatQuestion("q", "s")).rejects.toMatchObject({ code: "validation_error" });
    expect(fakeWindow.dispatchEvent).not.toHaveBeenCalled();
  });

  it("non-JSON failures (proxy errors) get a generic status message", async () => {
    mockFetch(502, undefined);
    await expect(chatQuestion("q", "s")).rejects.toThrow("Request failed with status 502");
  });
});

describe("uploadPDF", () => {
  it("surfaces the backend error message and action", async () => {
    mockFetch(400, body("invalid_file", "That file doesn't look like a valid PDF.", "reupload"));
    await expect(uploadPDF(new File(["x"], "a.pdf"), "sid")).rejects.toMatchObject({
      message: "That file doesn't look like a valid PDF.", code: "invalid_file", action: "reupload",
    });
  });
});


describe("typed client: URLs, bodies and request behaviour", () => {
  it("calls the page's own origin (the Next.js /api rewrite reaches the backend), never the backend directly", async () => {
    const spy = mockFetch(200, { mode: "chat", content: "hi", sources: [] });
    await chatQuestion("Why?", "sess-1", 5, []);
    expect(new URL(spy.mock.calls[0][0].url).origin).toBe("http://localhost:3000");   // jsdom page origin, not :8000
  });

  it("sends JSON bodies (not query strings) to /api/v1 with credentials", async () => {
    const spy = mockFetch(200, { mode: "chat", content: "hi", sources: [] });
    await chatQuestion("What is mitosis?", "sess-1", 7, [{ role: "user", content: "hello" }]);
    const req = spy.mock.calls[0][0];
    expect(req.method).toBe("POST");
    expect(new URL(req.url).pathname).toBe("/api/v1/chat");
    expect(new URL(req.url).search).toBe("");                       // top_k travels in the body now
    expect(req.credentials).toBe("include");
    expect(await req.json()).toEqual({
      question: "What is mitosis?", session_id: "sess-1", top_k: 7, history: [{ role: "user", content: "hello" }],
    });
  });

  it("GET calls use query and path parameters", async () => {
    const spy = mockFetch(200, { history: [] });
    await fetchHistory("chat", 25);
    await fetchSessionHistory("abc-123");
    expect(spy.mock.calls[0][0].url).toMatch(/\/api\/v1\/history\?mode=chat&limit=25$/);
    expect(new URL(spy.mock.calls[1][0].url).pathname).toBe("/api/v1/history/session/abc-123");
  });

  it("identical GETs that are in flight share one network request; POSTs never do", async () => {
    const spy = mockFetch(200, { shop_unlocked: true, level: 1, coins: 0 });
    const [a, b] = await Promise.all([fetchShop(), fetchShop()]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    await fetchShop();                                              // finished -> a new request is allowed
    expect(spy).toHaveBeenCalledTimes(2);

    const post = mockFetch(200, { mode: "chat", content: "x", sources: [] });
    await Promise.all([chatQuestion("q", "s"), chatQuestion("q", "s")]);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("rawApi reports errors instead of throwing, with no redirect or global event (login form / auth probe)", async () => {
    mockFetch(401, body("unauthenticated", "Please log in to continue.", "relogin"));
    const { data, error, response } = await rawApi.GET("/auth/me");
    expect(data).toBeUndefined();
    expect(response.status).toBe(401);
    expect(apiErrorMessage(error, "fallback")).toBe("Please log in to continue.");
    expect(fakeWindow.location.href).toBe("/");
    expect(fakeWindow.dispatchEvent).not.toHaveBeenCalled();
  });

  it("uploadPDF posts multipart form data to /api/v1/upload", async () => {
    const document = { id: "sid", filename: "notes.pdf", file_hash: "h", status: "queued", error: null, chunks: null,
      embedding_model: null, created_at: "t", last_used_at: "t" };
    const spy = mockFetch(202, { ok: true, message: "received", session_id: "sid", reused: false, document });
    const res = await uploadPDF(new File(["%PDF-1.4"], "notes.pdf", { type: "application/pdf" }), "sid");
    const req = spy.mock.calls[0][0];
    expect(new URL(req.url).pathname).toBe("/api/v1/upload");
    expect(req.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    const form = await req.formData();
    expect(form.get("session_id")).toBe("sid");
    expect(await (form.get("file") as Blob).text()).toBe("%PDF-1.4");   // the real file travels in the "file" part
    expect(res.session_id).toBe("sid");
    expect(res.document.status).toBe("queued");           // answered at once; indexing continues on the server
  });
});


describe("documents", () => {
  const document = { id: "sid", filename: "notes.pdf", file_hash: "h", status: "ready", error: null, chunks: 4,
    embedding_model: "m", created_at: "t", last_used_at: "t" };

  it("lists my documents", async () => {
    const spy = mockFetch(200, { documents: [document] });
    expect(await fetchDocuments()).toEqual([document]);
    expect(new URL(spy.mock.calls[0][0].url).pathname).toBe("/api/v1/documents");
  });

  it("reads one document's status by id", async () => {
    const spy = mockFetch(200, document);
    expect((await fetchDocument("sid"))?.status).toBe("ready");
    expect(new URL(spy.mock.calls[0][0].url).pathname).toBe("/api/v1/documents/sid");
  });

  it("answers null when the server no longer has the document, and throws for anything else", async () => {
    mockFetch(404, body("document_not_found", "That document couldn't be found."));
    expect(await fetchDocument("gone")).toBeNull();
    mockFetch(500, body("internal", "Something went wrong on our side. Please try again.", "retry"));
    await expect(fetchDocument("sid")).rejects.toMatchObject({ code: "internal" });
  });
});
