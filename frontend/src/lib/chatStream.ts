// Asking a question: the streaming endpoint (POST /chat/stream, Server-Sent Events) with incremental text, and the
// plain endpoint (POST /chat) as the fallback when the stream cannot be used.
//
// Frames: `token` {text} ... then `sources` {sources, blocked, needs_clarification, rewards}; a failure after the first
// token is an `error` event in the unified error shape, a failure before it is an ordinary HTTP error.
import { chatQuestion } from "./api";
import { API_BASE_URL, throwForResponse } from "./api/client";
import { ApiError } from "./api/errors";

export interface ChatAnswer {
  content: string;
  sources: string[];
  /** The document doesn't contain what was asked ("I couldn't find that in your document"). */
  blocked: boolean;
  needsClarification: boolean;
  rewards?: any;
}

export interface AskOptions {
  question: string;
  sessionId: string;
  history: { role: string; content: string }[];
  topK?: number;
  /** Aborting (the user left, started a new chat ...) rejects with an AbortError and never falls back. */
  signal?: AbortSignal;
  /** Called with each piece of the answer as it arrives. */
  onToken?: (text: string) => void;
  /** Called when the stream is abandoned for the plain endpoint: drop what was shown so far, the full answer follows. */
  onFallback?: () => void;
}

export class StreamUnavailableError extends Error {
  constructor(message = "The answer stream ended before it was finished") {
    super(message);
    this.name = "StreamUnavailableError";
  }
}

// ── Server-Sent Events ──────────────────────────────────────────────────────────

export interface SseFrame { event: string; data: any }

/** The frames of an SSE body, in order, however the network happened to chunk them. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = parseFrame(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (frame) yield frame;
      }
      if (done) break;
    }
    const rest = parseFrame(buffer);                      // a final frame with no blank line after it
    if (rest) yield rest;
  } finally {
    reader.cancel().catch(() => {});                      // leaving early closes the connection
  }
}

function parseFrame(raw: string): SseFrame | null {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":") || !line) continue;          // comment / keep-alive
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length === 0) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) };
  } catch {
    return null;                                          // a malformed frame is skipped, not fatal
  }
}

// ── Streaming ───────────────────────────────────────────────────────────────────

/** Errors the server answered definitively: asking again another way would only repeat them. */
const DEFINITE_CODES = new Set(["provider_quota", "provider_key_rejected", "provider_settings_invalid", "rate_limited"]);
const isDefinite = (err: unknown): boolean =>
  err instanceof ApiError &&
  ((err.status >= 400 && err.status < 500) || DEFINITE_CODES.has(err.code) || err.code.startsWith("document_") || err.code === "session_expired");

export const isAbortError = (err: unknown): boolean => (err as { name?: string } | null)?.name === "AbortError";

export async function streamChat(opts: AskOptions): Promise<ChatAnswer> {
  const response = await globalThis.fetch(`${API_BASE_URL}/chat/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ question: opts.question, session_id: opts.sessionId, history: opts.history, top_k: opts.topK ?? 5 }),
    signal: opts.signal,
  });
  if (!response.ok) await throwForResponse(response);     // the same ApiError (and global effects) as every other call
  if (!response.body) throw new StreamUnavailableError("This browser can't read the answer as it streams");

  let content = "";
  let final: any = null;
  for await (const { event, data } of readSse(response.body)) {
    if (event === "token" && typeof data?.text === "string") {
      content += data.text;
      opts.onToken?.(data.text);
    } else if (event === "sources") {
      final = data;
    } else if (event === "error") {
      // An error after the first token: the same handling as an HTTP error of that kind (quota notice ...).
      const code = String(data?.error?.code ?? "");
      const status = code === "provider_quota" || code === "rate_limited" ? 429 : DEFINITE_CODES.has(code) || code.startsWith("document_") || code === "session_expired" ? 400 : 502;
      await throwForResponse(new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));
    }
  }
  if (!final) throw new StreamUnavailableError();
  return {
    content,
    sources: Array.isArray(final.sources) ? final.sources.map(String) : [],
    blocked: !!final.blocked,
    needsClarification: !!final.needs_clarification,
    rewards: final.rewards ?? undefined,
  };
}

/**
 * Stream the answer; if the stream can't be used (network trouble, a server error, a broken or empty stream) ask the
 * plain endpoint instead. A cancelled request is not retried, and neither is an answer the server gave on purpose
 * (not logged in, quota used up, document gone ...).
 */
export async function askChat(opts: AskOptions): Promise<ChatAnswer> {
  try {
    return await streamChat(opts);
  } catch (err) {
    if (isAbortError(err) || opts.signal?.aborted || isDefinite(err)) throw err;
    opts.onFallback?.();
    const data = await chatQuestion(opts.question, opts.sessionId, opts.topK ?? 5, opts.history, opts.signal);
    return {
      content: String(data?.content ?? ""),
      sources: Array.isArray(data?.sources) ? data.sources.map(String) : [],
      blocked: !!data?.blocked,
      needsClarification: !!data?.needs_clarification,
      rewards: data?.rewards ?? undefined,
    };
  }
}
