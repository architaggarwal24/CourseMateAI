/** @vitest-environment node */
// The Worker forwards every /api call it does not answer itself to the Python backend (Phase 4 staged port).
import { describe, expect, it, vi } from "vitest";
import { proxyToBackend } from "./proxy";

const SECRET = "s".repeat(40);

function capture(response: Response | Error = new Response("ok")) {
  const calls: Request[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(input, init));
    if (response instanceof Error) throw response;
    return response;
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe("proxyToBackend", () => {
  it("sends the same path, query, method, body and cookies to the backend", async () => {
    const { calls, fetchImpl } = capture(new Response('{"a":1}', { status: 201, headers: { "content-type": "application/json" } }));
    const req = new Request("https://study.example.com/api/v1/quiz/generate?n=5", {
      method: "POST",
      headers: { cookie: "session_token=abc", "content-type": "application/json", origin: "https://study.example.com" },
      body: JSON.stringify({ topic: "cells" }),
    });
    const res = await proxyToBackend(req, { backendUrl: "https://legacy.example.com/", fetchImpl });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ a: 1 });
    const sent = calls[0];
    expect(sent.url).toBe("https://legacy.example.com/api/v1/quiz/generate?n=5");
    expect(sent.method).toBe("POST");
    expect(sent.headers.get("cookie")).toBe("session_token=abc");
    expect(sent.headers.get("origin")).toBe("https://study.example.com");
    expect(sent.headers.get("x-forwarded-proto")).toBe("https");
    expect(sent.headers.get("x-forwarded-host")).toBe("study.example.com");
    expect(await sent.text()).toBe('{"topic":"cells"}');
  });

  it("names the real client and proves itself only when a secret is set", async () => {
    const { calls, fetchImpl } = capture();
    const req = new Request("https://s.example.com/api/v1/auth/login", {
      headers: { "cf-connecting-ip": "198.51.100.4", "x-coursemateai-client-ip": "6.6.6.6", "x-coursemateai-proxy": "forged" },
    });
    await proxyToBackend(req, { backendUrl: "http://b", proxySecret: SECRET, fetchImpl });
    expect(calls[0].headers.get("x-coursemateai-proxy")).toBe(SECRET);
    expect(calls[0].headers.get("x-coursemateai-client-ip")).toBe("198.51.100.4");

    await proxyToBackend(req, { backendUrl: "http://b", fetchImpl });       // no secret: the forged headers go nowhere
    expect(calls[1].headers.get("x-coursemateai-proxy")).toBeNull();
    expect(calls[1].headers.get("x-coursemateai-client-ip")).toBeNull();
  });

  it("drops hop-by-hop headers and asks for an uncompressed answer", async () => {
    const { calls, fetchImpl } = capture();
    const req = new Request("https://s.example.com/api/v1/x", { headers: { "accept-encoding": "gzip, br", connection: "keep-alive", "cf-ray": "1" } });
    await proxyToBackend(req, { backendUrl: "http://b", fetchImpl });
    expect(calls[0].headers.get("accept-encoding")).toBe("identity");
    expect(calls[0].headers.get("connection")).toBeNull();
    expect(calls[0].headers.get("cf-ray")).toBeNull();
  });

  it("keeps every Set-Cookie the backend sends and does not follow redirects", async () => {
    const headers = new Headers({ location: "/login" });
    headers.append("set-cookie", "session_token=x; HttpOnly; Path=/");
    headers.append("set-cookie", "csrf=y; Path=/");
    const { fetchImpl } = capture(new Response(null, { status: 302, headers }));
    const res = await proxyToBackend(new Request("https://s.example.com/api/v1/auth/logout"), { backendUrl: "http://b", fetchImpl });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.getSetCookie()).toEqual(["session_token=x; HttpOnly; Path=/", "csrf=y; Path=/"]);
    expect((fetchImpl as any).mock.calls[0][1].redirect).toBe("manual");
  });

  it("streams the answer through as it arrives", async () => {
    let push!: (s: string) => void;
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(new TextEncoder().encode(s));
        close = () => c.close();
      },
    });
    const { fetchImpl } = capture(new Response(body, { headers: { "content-type": "text/event-stream" } }));
    const res = await proxyToBackend(new Request("https://s.example.com/api/v1/chat"), { backendUrl: "http://b", fetchImpl });
    const reader = res.body!.getReader();
    push("data: one\n\n");
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: one\n\n");
    push("data: two\n\n");
    close();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: two\n\n");
  });

  it("answers in the API's error shape when the backend can't be reached", async () => {
    const { fetchImpl } = capture(new TypeError("fetch failed"));
    const res = await proxyToBackend(new Request("https://s.example.com/api/v1/me"), { backendUrl: "http://b", fetchImpl });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "backend_unreachable", action: "retry" });
  });

  it("says so when no backend is configured", async () => {
    const { fetchImpl } = capture();
    const res = await proxyToBackend(new Request("https://s.example.com/api/v1/me"), { backendUrl: "", fetchImpl });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("backend_not_configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
