// Calling a model for a user (Stage 4.3): the plan's quota first, then the route's targets in order (the next one
// takes over when one fails - before the first word, for a streamed answer), and every call metered.
// Users can't bring their own keys: every call is the server's (and counts against the plan).
import * as log from "../log";
import type { Db } from "../db";
import { HttpError } from "../http";
import type { Tier } from "../account/plans";
import { route, type Job, type Target } from "./models";
import { apiLlm, DEFAULT_MAX_OUTPUT } from "./providers";
import { isCapped, recordCall, releaseCall, reserveCall } from "./usage";
import { aiSettings, overrideTarget, withSlots } from "./config";
import { leaked, safeLength, withGuard } from "./guard";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface CallOptions {
  maxOutputTokens?: number; temperature?: number; timeoutMs?: number;
  /** Ask for a JSON answer where the provider has a switch for it (Gemini, OpenAI). The prompt must ask too. */
  json?: boolean;
}
/** `admin`: their own model (ai/config.ts) is tried first on their requests. */
export interface Caller { id: number; owner: boolean; tier: Tier; admin?: boolean }

export interface Llm {
  generate(messages: ChatMessage[], opts: CallOptions): Promise<{ text: string; tokensIn?: number; tokensOut?: number }>;
  stream(messages: ChatMessage[], opts: CallOptions): AsyncIterable<{ text?: string; tokensIn?: number; tokensOut?: number }>;
}

type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<{ response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }> };

export { DEFAULT_MAX_OUTPUT };

/** About four characters a token: for a provider that reports no usage. */
export const estimateTokens = (text: string) => Math.ceil((text || "").length / 4);
const promptTokens = (messages: ChatMessage[]) => estimateTokens(messages.map((m) => m.content).join("\n"));

function workersAiLlm(ai: AiBinding, t: Target): Llm {
  const run = async (messages: ChatMessage[], o: CallOptions) => {
    const r = await ai.run(t.model, { messages, max_tokens: Math.min(o.maxOutputTokens ?? 1024, 2048), temperature: o.temperature });
    if (typeof r?.response !== "string") throw new Error("Workers AI gave no answer");
    return { text: r.response, tokensIn: r.usage?.prompt_tokens, tokensOut: r.usage?.completion_tokens };
  };
  return {
    generate: run,
    async *stream(messages, o) {                                  // answered whole, sent as one piece
      const r = await run(messages, o);
      yield { text: r.text };
      yield { tokensIn: r.tokensIn, tokensOut: r.tokensOut };
    },
  };
}

type Factory = (t: Target, env: { AI?: unknown }) => Llm;
let testFactory: Factory | null = null;
/** Tests answer with scripted models (src/server/test/ai-fakes.ts). */
export function setLlmFactoryForTests(f: Factory | null): void {
  testFactory = f;
}

export function llmFor(t: Target, env: { AI?: unknown }): Llm {
  if (testFactory) return testFactory(t, env);
  if (t.provider === "workers-ai") {
    if (!env.AI) throw new Error("Workers AI isn't bound");
    return workersAiLlm(env.AI as AiBinding, t);
  }
  return apiLlm(t);
}

export function noModel(): HttpError {
  return new HttpError(503, "ai_unavailable", "The AI couldn't answer just now. Please try again in a moment.", "retry");
}

/** An answer that repeated the app's instructions (the canary showed up): withheld, and an alert in the logs. */
export function withheld(caller: Caller, job: Job): HttpError {
  log.warn(`[coursemate-ai] ALERT canary in an answer: withheld (user ${caller.id}, job ${job})`);
  return new HttpError(502, "answer_withheld", "That answer was withheld because it didn't follow the app's rules. Please ask again, or rephrase.", "retry");
}

interface Ctx { db: Db; env: { AI?: unknown } }

/** The models to try, in order. Reserves one of today's calls first (see reserveCall); `reserved` says if it did. */
async function targets(ctx: Ctx, caller: Caller, job: Job): Promise<{ list: Target[]; reserved: boolean }> {
  const reserved = await reserveCall(ctx.db, caller);
  try {
    return { list: await pickTargets(ctx, caller, job), reserved };
  } catch (e) {
    if (reserved) await releaseCall(ctx.db, caller.id).catch(() => {});
    throw e;
  }
}

async function pickTargets(ctx: Ctx, caller: Caller, job: Job): Promise<Target[]> {
  const [capped, saved] = await Promise.all([isCapped(ctx.db), aiSettings(ctx.db, caller.admin ? caller.id : undefined)]);
  // The models admins saved for everyone, over the LLM_* settings.
  const list = route(caller.tier, job, { capped, env: withSlots(process.env, saved.slots) });
  // An admin's own model goes first (the normal ones stay behind it). Past the spend cap only a free one still does.
  const mine = caller.admin ? overrideTarget(saved.override, process.env, saved.ollamaUrl) : null;
  if (mine && (!capped || mine.provider === "ollama" || mine.provider === "workers-ai")) {
    list.unshift(mine);
    for (let i = list.length - 1; i > 0; i--) if (list[i].provider === mine.provider && list[i].model === mine.model) list.splice(i, 1);
  }
  if (!list.length) throw new HttpError(503, "ai_not_configured", "This server has no AI model set up yet (LLM_FAST and a provider key).", "retry");
  return list;
}

/** One answer, whole. */
export async function generate(ctx: Ctx, caller: Caller, job: Job, raw: ChatMessage[], opts: CallOptions = {}) {
  const messages = withGuard(raw);
  const { list, reserved } = await targets(ctx, caller, job);
  let lastError: unknown;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    try {
      const r = await llmFor(t, ctx.env).generate(messages, opts);
      if (!r.text?.trim()) throw new Error("empty answer");
      await recordCall(ctx.db, { userId: caller.id, target: t, job, tokensIn: r.tokensIn ?? promptTokens(messages), tokensOut: r.tokensOut ?? estimateTokens(r.text), fallback: i > 0, reserved });
      if (leaked(r.text)) { lastError = withheld(caller, job); break; }
      return { text: r.text, target: t };
    } catch (e) {
      lastError = e;
      log.warn(`[coursemate-ai] ${t.provider}:${t.model} failed (${e instanceof Error ? e.message.slice(0, 200) : "error"})`);
    }
  }
  if (lastError instanceof HttpError && lastError.code === "answer_withheld") throw lastError;   // answered (and metered), not shown
  if (reserved) await releaseCall(ctx.db, caller.id).catch(() => {});      // nobody answered: the call isn't spent
  throw noModel();
}

/**
 * A streamed answer. Resolves once the first words have arrived (from whichever target managed it), so a failure
 * before that is an ordinary error. `pieces` then yields the rest; `done` resolves with the whole text (metered).
 */
export async function stream(ctx: Ctx, caller: Caller, job: Job, raw: ChatMessage[], opts: CallOptions = {}) {
  const messages = withGuard(raw);
  const { list, reserved } = await targets(ctx, caller, job);
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const it = llmFor(t, ctx.env).stream(messages, opts)[Symbol.asyncIterator]();
    let first: IteratorResult<{ text?: string; tokensIn?: number; tokensOut?: number }>;
    try {
      do { first = await it.next(); } while (!first.done && !first.value.text);
      if (first.done) throw new Error("empty answer");
    } catch (e) {
      log.warn(`[coursemate-ai] ${t.provider}:${t.model} failed before answering (${e instanceof Error ? e.message.slice(0, 200) : "error"})`);
      continue;
    }
    let text = first.value.text ?? "";
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    let resolveDone!: (v: { text: string }) => void;
    let rejectDone!: (e: unknown) => void;
    const done = new Promise<{ text: string }>((res, rej) => { resolveDone = res; rejectDone = rej; });
    done.catch(() => {});
    const fallback = i > 0;
    async function* pieces(): AsyncGenerator<string> {
      // the canary check: a tail that could be the start of the marker is held back until the next piece shows
      // what it is, so not even part of it goes out
      let sent = 0;
      const release = function* (final: boolean): Generator<string> {
        if (leaked(text)) throw withheld(caller, job);
        const upTo = final ? text.length : safeLength(text);
        if (upTo > sent) { yield text.slice(sent, upTo); sent = upTo; }
      };
      try {
        yield* release(false);
        for (;;) {
          const r = await it.next();
          if (r.done) break;
          if (r.value.text) { text += r.value.text; yield* release(false); }
          if (r.value.tokensIn !== undefined) tokensIn = r.value.tokensIn;
          if (r.value.tokensOut !== undefined) tokensOut = r.value.tokensOut;
        }
        yield* release(true);
        await recordCall(ctx.db, { userId: caller.id, target: t, job, tokensIn: tokensIn ?? promptTokens(messages), tokensOut: tokensOut ?? estimateTokens(text), fallback, reserved });
        resolveDone({ text });
      } catch (e) {
        // what was said still counts: the provider charges for it
        await recordCall(ctx.db, { userId: caller.id, target: t, job, tokensIn: promptTokens(messages), tokensOut: estimateTokens(text), fallback, reserved }).catch(() => {});
        rejectDone(e);
        throw e;
      }
    }
    return { target: t, pieces: pieces(), done };
  }
  if (reserved) await releaseCall(ctx.db, caller.id).catch(() => {});
  throw noModel();
}
