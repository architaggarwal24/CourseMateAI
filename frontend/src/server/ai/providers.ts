// The model providers, spoken to directly over HTTPS (Stage 4.3). A few small clients instead of an SDK keep the
// Worker under the free plan's 3 MB size limit. Each one answers whole or streams; usage comes from the provider.
//   gemini   Google AI Studio, generateContent / streamGenerateContent (SSE); "thought" parts are skipped
//   openai   /v1/chat/completions (SSE, usage in the last chunk); also NVIDIA NIM, which speaks the same API
//   claude   Anthropic /v1/messages (SSE events)
import type { ChatMessage, CallOptions, Llm } from "./run";
import type { Target } from "./models";

export const DEFAULT_MAX_OUTPUT = 4096;
const NVIDIA_BASE = "https://integrate.api.nvidia.com/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

type Piece = { text?: string; tokensIn?: number; tokensOut?: number };

export class ProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function post(url: string, headers: Record<string, string>, body: unknown, o: CallOptions, fetchImpl: typeof fetch): Promise<Response> {
  const res = await fetchImpl(url, {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new ProviderError(res.status, `${res.status} ${detail}`);           // logged only, never shown to users
  }
  return res;
}

/** The `data:` payloads of a Server-Sent Events body (with the event name, for Anthropic). */
export async function* sseData(body: ReadableStream<Uint8Array> | null): AsyncGenerator<{ event: string; data: string }> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(buf.slice(cut).match(/^\r?\n\r?\n/)![0].length + cut);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
    if (done) break;
  }
}

const parse = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };

// ── Gemini ───────────────────────────────────────────────────────────────────
function gemini(t: Target, fetchImpl: typeof fetch): Llm {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(t.model)}`;
  const headers = { "x-goog-api-key": t.apiKey ?? "" };
  const body = (messages: ChatMessage[], o: CallOptions) => {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    return {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: {
        maxOutputTokens: o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT, ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
        ...(o.json ? { responseMimeType: "application/json" } : {}),
      },
    };
  };
  const text = (j: any) => (j?.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought && typeof p.text === "string").map((p: any) => p.text).join("");
  const usage = (j: any) => ({ tokensIn: j?.usageMetadata?.promptTokenCount, tokensOut: j?.usageMetadata?.candidatesTokenCount });
  return {
    async generate(messages, o) {
      const j = await (await post(`${base}:generateContent`, headers, body(messages, o), o, fetchImpl)).json();
      return { text: text(j), ...usage(j) };
    },
    async *stream(messages, o) {
      const res = await post(`${base}:streamGenerateContent?alt=sse`, headers, body(messages, o), o, fetchImpl);
      let last: Piece = {};
      for await (const { data } of sseData(res.body)) {
        const j = parse(data);
        if (!j) continue;
        if (j.error) throw new ProviderError(500, String(j.error.message ?? "error"));
        const piece = text(j);
        if (piece) yield { text: piece };
        if (j.usageMetadata) last = usage(j);
      }
      yield last;
    },
  };
}

// ── OpenAI chat completions (and NVIDIA NIM) ────────────────────────────────
function openaiCompatible(t: Target, fetchImpl: typeof fetch, baseUrl: string, newStyle: boolean): Llm {
  const headers = { authorization: `Bearer ${t.apiKey ?? ""}` };
  // OpenAI's reasoning models take max_completion_tokens and no temperature.
  const reasoning = newStyle && /^(o\d|gpt-5)/i.test(t.model);
  const body = (messages: ChatMessage[], o: CallOptions, stream: boolean) => ({
    model: t.model, messages,
    ...(newStyle ? { max_completion_tokens: o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT } : { max_tokens: o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT }),
    ...(o.temperature !== undefined && !reasoning ? { temperature: o.temperature } : {}),
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(o.json && newStyle ? { response_format: { type: "json_object" } } : {}),
  });
  return {
    async generate(messages, o) {
      const j = await (await post(`${baseUrl}/chat/completions`, headers, body(messages, o, false), o, fetchImpl)).json();
      return { text: j?.choices?.[0]?.message?.content ?? "", tokensIn: j?.usage?.prompt_tokens, tokensOut: j?.usage?.completion_tokens };
    },
    async *stream(messages, o) {
      const res = await post(`${baseUrl}/chat/completions`, headers, body(messages, o, true), o, fetchImpl);
      let last: Piece = {};
      for await (const { data } of sseData(res.body)) {
        if (data === "[DONE]") break;
        const j = parse(data);
        if (!j) continue;
        const piece = j.choices?.[0]?.delta?.content;
        if (typeof piece === "string" && piece) yield { text: piece };
        if (j.usage) last = { tokensIn: j.usage.prompt_tokens, tokensOut: j.usage.completion_tokens };
      }
      yield last;
    },
  };
}

// ── Anthropic ────────────────────────────────────────────────────────────────
function claude(t: Target, fetchImpl: typeof fetch): Llm {
  const headers = { "x-api-key": t.apiKey ?? "", "anthropic-version": "2023-06-01" };
  const body = (messages: ChatMessage[], o: CallOptions, stream: boolean) => {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    return {
      model: t.model, max_tokens: o.maxOutputTokens ?? DEFAULT_MAX_OUTPUT, ...(system ? { system } : {}),
      messages: messages.filter((m) => m.role !== "system"),
      ...(o.temperature !== undefined ? { temperature: o.temperature } : {}), ...(stream ? { stream: true } : {}),
    };
  };
  return {
    async generate(messages, o) {
      const j = await (await post("https://api.anthropic.com/v1/messages", headers, body(messages, o, false), o, fetchImpl)).json();
      const text = (j?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
      return { text, tokensIn: j?.usage?.input_tokens, tokensOut: j?.usage?.output_tokens };
    },
    async *stream(messages, o) {
      const res = await post("https://api.anthropic.com/v1/messages", headers, body(messages, o, true), o, fetchImpl);
      const usage: Piece = {};
      for await (const { event, data } of sseData(res.body)) {
        const j = parse(data);
        if (!j) continue;
        if (event === "error" || j.type === "error") throw new ProviderError(500, String(j.error?.message ?? "error"));
        if (j.type === "message_start") usage.tokensIn = j.message?.usage?.input_tokens;
        if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) yield { text: j.delta.text };
        if (j.type === "message_delta" && j.usage?.output_tokens !== undefined) usage.tokensOut = j.usage.output_tokens;
      }
      yield usage;
    },
  };
}

export function apiLlm(t: Target, fetchImpl: typeof fetch = fetch): Llm {
  switch (t.provider) {
    case "gemini": return gemini(t, fetchImpl);
    case "openai": return openaiCompatible(t, fetchImpl, (process.env.OPENAI_BASE_URL || OPENAI_BASE).replace(/\/+$/, ""), true);
    case "nvidia": return openaiCompatible(t, fetchImpl, NVIDIA_BASE, false);
    case "claude": return claude(t, fetchImpl);
    default: throw new Error(`no API client for ${t.provider}`);
  }
}
