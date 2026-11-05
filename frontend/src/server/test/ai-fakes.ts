// Scripted models for tests: each "provider:model" answers with a text (streamed in words), throws, or runs a
// function of the messages. Every call is recorded.
import type { ChatMessage, Llm } from "../ai/run";
import type { Target } from "../ai/models";

type Script = string | Error | ((messages: ChatMessage[]) => string);

export function fakeLlms(scripts: Record<string, Script>) {
  const calls: { target: string; messages: ChatMessage[]; stream: boolean }[] = [];
  const answer = (key: string, messages: ChatMessage[]) => {
    const s = scripts[key] ?? scripts["*"];
    if (s === undefined) throw new Error(`no script for ${key}`);
    if (s instanceof Error) throw s;
    return typeof s === "function" ? s(messages) : s;
  };
  const factory = (t: Target): Llm => {
    const key = `${t.provider}:${t.model}`;
    return {
      async generate(messages) {
        calls.push({ target: key, messages, stream: false });
        const text = answer(key, messages);
        return { text, tokensIn: 100, tokensOut: 50 };
      },
      async *stream(messages) {
        calls.push({ target: key, messages, stream: true });
        const text = answer(key, messages);
        for (const w of text.split(/(?<= )/)) yield { text: w };
        yield { tokensIn: 100, tokensOut: 50 };
      },
    };
  };
  return { factory, calls };
}

export const AI_ENV = {
  LLM_FAST: "gemini:flash-lite",
  LLM_STRONG: "gemini:flash",
  LLM_PREMIUM: "claude:sonnet",
  GOOGLE_API_KEY: "g-key",
  ANTHROPIC_API_KEY: "a-key",
  MODEL_PRICES_JSON: JSON.stringify({ "gemini:flash-lite": [0.1, 0.4], "gemini:flash": [0.3, 2.5], "claude:*": [3, 15] }),
};
