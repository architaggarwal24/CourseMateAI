import { describe, expect, it } from "vitest";
import { apiLlm, ProviderError, sseData } from "./providers";
import type { Target } from "./models";

type Seen = { url: string; headers: Record<string, string>; body: any };

function fakeFetch(reply: { status?: number; json?: unknown; sse?: string[]; raw?: string }, seen: Seen[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const status = reply.status ?? 200;
    if (reply.sse) {
      const enc = new TextEncoder();
      const parts = reply.sse;
      const body = new ReadableStream<Uint8Array>({
        start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); },
      });
      return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(reply.raw ?? JSON.stringify(reply.json ?? {}), { status });
  }) as unknown as typeof fetch;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const msgs = [
  { role: "system" as const, content: "Be brief." },
  { role: "user" as const, content: "Hi" },
];
const target = (provider: Target["provider"], model: string): Target => ({ slot: "fast", provider, model, apiKey: "k-1" });

describe("sseData", () => {
  it("splits events across chunk boundaries and CRLF, keeps event names, joins data lines", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of ["event: a\r\nda", "ta: 1\r\n\r\ndata: x\ndata: y\n\n", ": comment\n\ndata: last\n\n"]) c.enqueue(enc.encode(p));
        c.close();
      },
    });
    expect(await collect(sseData(body))).toEqual([
      { event: "a", data: "1" }, { event: "message", data: "x\ny" }, { event: "message", data: "last" },
    ]);
  });
});

describe("gemini", () => {
  it("sends the system instruction and key header, skips thought parts, reads usage", async () => {
    const seen: Seen[] = [];
    const llm = apiLlm(target("gemini", "gemini-x"), fakeFetch({ json: {
      candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "Hello" }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
    } }, seen));
    expect(await llm.generate(msgs, { maxOutputTokens: 100, temperature: 0.2 })).toEqual({ text: "Hello", tokensIn: 5, tokensOut: 2 });
    expect(seen[0].url).toContain("/models/gemini-x:generateContent");
    expect(seen[0].headers["x-goog-api-key"]).toBe("k-1");
    expect(seen[0].body.systemInstruction.parts[0].text).toBe("Be brief.");
    expect(seen[0].body.contents).toEqual([{ role: "user", parts: [{ text: "Hi" }] }]);
    expect(seen[0].body.generationConfig).toEqual({ maxOutputTokens: 100, temperature: 0.2 });
  });

  it("streams text pieces then the usage", async () => {
    const seen: Seen[] = [];
    const llm = apiLlm(target("gemini", "g"), fakeFetch({ sse: [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hel" }] } }] })}\n\n`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "lo" }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 } })}\n\n`,
    ] }, seen));
    expect(await collect(llm.stream(msgs, {}))).toEqual([{ text: "Hel" }, { text: "lo" }, { tokensIn: 3, tokensOut: 1 }]);
    expect(seen[0].url).toContain(":streamGenerateContent?alt=sse");
  });
});

describe("openai-compatible", () => {
  it("uses max_completion_tokens and drops temperature for reasoning models", async () => {
    const seen: Seen[] = [];
    const llm = apiLlm(target("openai", "gpt-5-mini"), fakeFetch({ json: { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 4, completion_tokens: 1 } } }, seen));
    expect(await llm.generate(msgs, { temperature: 0.5 })).toEqual({ text: "ok", tokensIn: 4, tokensOut: 1 });
    expect(seen[0].url).toBe("https://api.openai.com/v1/chat/completions");
    expect(seen[0].headers.authorization).toBe("Bearer k-1");
    expect(seen[0].body.max_completion_tokens).toBe(4096);
    expect(seen[0].body.temperature).toBeUndefined();
    expect(seen[0].body.messages).toEqual(msgs);
  });

  it("NVIDIA: own base URL, max_tokens, keeps temperature; stream stops at [DONE] with usage", async () => {
    const seen: Seen[] = [];
    const llm = apiLlm(target("nvidia", "meta/llama"), fakeFetch({ sse: [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "A" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "B" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 9, completion_tokens: 2 } })}\n\n`,
      "data: [DONE]\n\n",
    ] }, seen));
    expect(await collect(llm.stream(msgs, { temperature: 0.3 }))).toEqual([{ text: "A" }, { text: "B" }, { tokensIn: 9, tokensOut: 2 }]);
    expect(seen[0].url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(seen[0].body).toMatchObject({ max_tokens: 4096, temperature: 0.3, stream: true, stream_options: { include_usage: true } });
  });
});

describe("claude", () => {
  it("moves system to the top level and reads text blocks", async () => {
    const seen: Seen[] = [];
    const llm = apiLlm(target("claude", "claude-x"), fakeFetch({ json: {
      content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "Yo" }], usage: { input_tokens: 7, output_tokens: 1 },
    } }, seen));
    expect(await llm.generate(msgs, {})).toEqual({ text: "Yo", tokensIn: 7, tokensOut: 1 });
    expect(seen[0].headers["x-api-key"]).toBe("k-1");
    expect(seen[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(seen[0].body).toMatchObject({ model: "claude-x", system: "Be brief.", max_tokens: 4096, messages: [{ role: "user", content: "Hi" }] });
  });

  it("streams deltas with usage from message_start and message_delta; error events throw", async () => {
    const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    const ok = apiLlm(target("claude", "c"), fakeFetch({ sse: [
      ev("message_start", { type: "message_start", message: { usage: { input_tokens: 11 } } }),
      ev("content_block_delta", { type: "content_block_delta", delta: { type: "text_delta", text: "Hi " } }),
      ev("content_block_delta", { type: "content_block_delta", delta: { type: "text_delta", text: "there" } }),
      ev("message_delta", { type: "message_delta", usage: { output_tokens: 2 } }),
      ev("message_stop", { type: "message_stop" }),
    ] }));
    expect(await collect(ok.stream(msgs, {}))).toEqual([{ text: "Hi " }, { text: "there" }, { tokensIn: 11, tokensOut: 2 }]);

    const bad = apiLlm(target("claude", "c"), fakeFetch({ sse: [ev("error", { type: "error", error: { message: "overloaded" } })] }));
    await expect(collect(bad.stream(msgs, {}))).rejects.toThrow("overloaded");
  });
});

describe("json mode", () => {
  it("Gemini asks for application/json; OpenAI for a json_object; NVIDIA and Claude are asked by the prompt only", async () => {
    const seen: Seen[] = [];
    const ok = { candidates: [{ content: { parts: [{ text: "{}" }] } }], choices: [{ message: { content: "{}" } }], content: [{ type: "text", text: "{}" }] };
    for (const t of [target("gemini", "g"), target("openai", "gpt-4o"), target("nvidia", "n"), target("claude", "c")]) {
      await apiLlm(t, fakeFetch({ json: ok }, seen)).generate(msgs, { json: true });
    }
    expect(seen[0].body.generationConfig.responseMimeType).toBe("application/json");
    expect(seen[1].body.response_format).toEqual({ type: "json_object" });
    expect(seen[2].body.response_format).toBeUndefined();
    expect(JSON.stringify(seen[3].body)).not.toContain("json_object");
  });
});

describe("errors", () => {
  it("a non-2xx reply is a ProviderError with the status", async () => {
    const llm = apiLlm(target("gemini", "g"), fakeFetch({ status: 429, raw: "quota" }));
    const err = await llm.generate(msgs, {}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBe(429);
  });

  it("workers-ai has no API client", () => {
    expect(() => apiLlm({ slot: "small", provider: "workers-ai", model: "m" })).toThrow(/no API client/);
  });
});
