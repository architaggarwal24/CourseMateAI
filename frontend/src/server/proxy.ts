// Everything under /api that the Worker does not answer itself goes on to the Python backend (Phase 4 is a staged
// port: each area moves to src/app/api/... and stops reaching this). The body streams both ways, so long AI answers
// arrive as they are written. Cookies pass through, so the login keeps working while auth still lives in Python.
import { apiError } from "./errors";

// Never forwarded: they describe one hop, not the request (RFC 9110 §7.6.1), or they are ours to set.
const DROP_REQUEST = new Set([
  "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "host",
  "content-length", "accept-encoding", "x-forwarded-proto", "x-forwarded-host",
  "x-coursemateai-proxy", "x-coursemateai-client-ip",
]);
const DROP_RESPONSE = new Set([
  "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "trailer",
  "content-encoding", "content-length", "set-cookie",
]);

export interface ProxyOptions {
  backendUrl: string;
  /** PROXY_SECRET: lets the backend believe X-CoursemateAI-Client-IP. Without it no client address is sent. */
  proxySecret?: string;
  fetchImpl?: typeof fetch;
}

function clientAddress(req: Request): string {
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "").trim();
}

export async function proxyToBackend(req: Request, { backendUrl, proxySecret, fetchImpl = fetch }: ProxyOptions): Promise<Response> {
  if (!backendUrl) {
    return apiError(503, "backend_not_configured", "The study server isn't connected yet. Please try again in a minute.", "retry");
  }
  const url = new URL(req.url);
  const target = `${backendUrl.replace(/\/+$/, "")}${url.pathname}${url.search}`;

  const headers = new Headers();
  req.headers.forEach((value, name) => {
    if (!DROP_REQUEST.has(name) && !name.startsWith("cf-")) headers.set(name, value);
  });
  headers.set("accept-encoding", "identity");          // a compressed body would be decoded here, then mislabelled
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
  headers.set("x-forwarded-host", url.host);
  if (proxySecret) {
    headers.set("x-coursemateai-proxy", proxySecret);
    const ip = clientAddress(req);
    if (ip) headers.set("x-coursemateai-client-ip", ip);
  }

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      // Needed to stream a request body (uploads) in Node; Workers ignore it.
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    return apiError(502, "backend_unreachable", "The study server didn't answer. Please try again in a moment.", "retry");
  }

  const out = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROP_RESPONSE.has(name)) out.set(name, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}
