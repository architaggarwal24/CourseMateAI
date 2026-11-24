// Calling a model for a user (Stage 4.3): the plan's quota first, then the route's targets in order (the next one
// takes over when one fails - before the first word, for a streamed answer), and every call metered.
// Money (ai/budget.ts): before each paid model is tried, its worst-case cost is reserved against the user's, the
// plan's and the global budget; a model a budget refuses is skipped (the free Workers AI one at the end always
// answers), and the reservation is settled to the real cost with the meters. When the user's own budgets have no
// room, their bought Mana (account/wallet.ts) pays for the model instead, if they have enough.
// Users can't bring their own keys: every call is the server's (and counts against the plan).
import * as log from "../log";
import type { Db } from "../db";
import { HttpError } from "../http";
import type { Tier } from "../account/plans";
import { route, type Job, type Target } from "./models";
import { apiLlm, DEFAULT_MAX_OUTPUT, SEES_IMAGES } from "./providers";
import { releaseCall, reserveCall } from "./usage";
import { loadLimits, meter, release, reserve, userScopes, worstCostMicro, type Hold, type Scope } from "./budget";
import { aiSettings, overrideTarget, withSlots } from "./config";
import { leaked, safeLength, withGuard } from "./guard";

/** `images`: pictures with a user message (Files stage 3), base64; only models that can see are given them. */
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; images?: { mime: string; data: string }[] }
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

type AiBinding = { run(model: string, input: Record<string, unknown>): Promise<WorkersAiAnswer> };
/**
 * What a Workers AI text model answers: the older models gave `{response}`, the newer ones (Gemma 4, Qwen 3.8 ...;
 * Cloudflare retired Llama 3.1 8B and the Llama 3.2 models on 20 Nov 2026) answer OpenAI-style `{choices}`.
 */
type WorkersAiAnswer = {
  response?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** The answer's text, whichever shape it came in, without any thinking the model wrote first. */
export function workersAiText(r: WorkersAiAnswer | null | undefined): string | null {
  const raw = typeof r?.response === "string" ? r.response : r?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") return null;
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export { DEFAULT_MAX_OUTPUT };

/** About four characters a token: for a provider that reports no usage. */
export const estimateTokens = (text: string) => Math.ceil((text || "").length / 4);
const promptTokens = (messages: ChatMessage[]) => estimateTokens(messages.map((m) => m.content).join("\n"));

function workersAiLlm(ai: AiBinding, t: Target): Llm {
  const run = async (messages: ChatMessage[], o: CallOptions) => {
    const max = Math.min(o.maxOutputTokens ?? 1024, 2048);
    // max_tokens is in every text model's schema (the newer ones also take max_completion_tokens; extra fields are
    // refused by some older ones, so only what all of them accept goes)
    const r = await ai.run(t.model, { messages: messages.map((m) => ({ role: m.role, content: m.content })), max_tokens: max, temperature: o.temperature });
    const text = workersAiText(r);
    if (!text) throw new Error("Workers AI gave no answer");
    return { text, tokensIn: r.usage?.prompt_tokens, tokensOut: r.usage?.completion_tokens };
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

/** The models to try, in order, and the budgets they're held to. Reserves one of today's calls first (see reserveCall). */
async function targets(ctx: Ctx, caller: Caller, job: Job, sees = false, countCall = true): Promise<{ list: Target[]; reserved: boolean; scopes: Scope[] }> {
  const reserved = countCall ? await reserveCall(ctx.db, caller) : false;
  try {
    const picked = await pickTargets(ctx, caller, job);
    if (!sees) return { ...picked, reserved };
    // a question with pictures: only models that can see them (never the free text-only one)
    const list = picked.list.filter((t) => SEES_IMAGES.has(t.provider));
    if (!list.length) throw new HttpError(503, "vision_unavailable", "Questions about pictures need an AI model that can see them, and none is set up here yet.", "retry");
    return { ...picked, list, reserved };
  } catch (e) {
    if (reserved) await releaseCall(ctx.db, caller.id).catch(() => {});
    throw e;
  }
}

async function pickTargets(ctx: Ctx, caller: Caller, job: Job): Promise<{ list: Target[]; scopes: Scope[] }> {
  const [limits, saved] = await Promise.all([loadLimits(ctx.db), aiSettings(ctx.db, caller.admin ? caller.id : undefined)]);
  // The models admins saved for everyone, over the LLM_* settings.
  const list = route(caller.tier, job, { env: withSlots(process.env, saved.slots) });
  // An admin's own model goes first (the normal ones stay behind it). It is held to the budgets like any other, so
  // past the cap only a free one still answers.
  const mine = caller.admin ? overrideTarget(saved.override, process.env, saved.ollamaUrl) : null;
  if (mine) {
    list.unshift(mine);
    for (let i = list.length - 1; i > 0; i--) if (list[i].provider === mine.provider && list[i].model === mine.model) list.splice(i, 1);
  }
  if (!list.length) throw new HttpError(503, "ai_not_configured", "This server has no AI model set up yet (LLM_FAST and a provider key).", "retry");
  return { list, scopes: userScopes(caller, limits) };
}

/**
 * Room for a call: the user's, the plan's and the global budget first; past the user's or the plan's, their Mana (with
 * the global cap still in force). `mana`: the Mana pays for this one.
 */
async function holdFor(ctx: Ctx, caller: Caller, scopes: Scope[], worst: number): Promise<{ hold: Hold | null; mana: boolean }> {
  const hold = await reserve(ctx.db, scopes, worst);
  if (hold || caller.owner) return { hold, mana: false };
  const paid = await reserve(ctx.db, scopes.filter((s) => s.key === "global"), worst, undefined, caller.id);
  return { hold: paid, mana: !!paid };
}

const hasImages = (messages: ChatMessage[]) => messages.some((m) => m.images?.length);

/**
 * Nothing could answer a question with pictures because the budgets turned the models that see away (the free model
 * can't see): a clear "not today" instead of a wrong answer.
 */
function imagesNeedBudget(caller: Caller): HttpError {
  const paid = caller.tier !== "apprentice";
  return new HttpError(429, "budget_images",
    `Questions about pictures need the full AI model, and today's AI budget is used up. It comes back at midnight UTC${paid ? ", or top up Mana to keep going" : ", or upgrade for more"}.`,
    "plans", { can_top_up: paid });
}

/** Meter a call and settle its reservation; a failure here is logged, not shown (the reservation then stays held). */
async function meterQuietly(ctx: Ctx, call: Parameters<typeof meter>[1], hold: Hold): Promise<void> {
  try {
    await meter(ctx.db, call, hold);
  } catch (e) {
    log.error(`[coursemate-ai] metering failed (${e instanceof Error ? e.message.slice(0, 200) : "error"})`);
  }
}

/**
 * One answer, whole. `limited`: a budget turned at least one model away (the answer came from a later, cheaper or
 * free one). `mana`: the user's Mana paid for it. `countCall: false`: not one of the plan's AI calls (a scanned page
 * has its own daily cap, study/ocr.ts); the money budgets hold either way.
 */
export async function generate(ctx: Ctx, caller: Caller, job: Job, raw: ChatMessage[], opts: CallOptions = {},
  { countCall = true }: { countCall?: boolean } = {}) {
  const messages = withGuard(raw);
  const sees = hasImages(messages);
  const { list, reserved, scopes } = await targets(ctx, caller, job, sees, countCall);
  let lastError: unknown;
  let limited = false;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const { hold, mana } = await holdFor(ctx, caller, scopes, worstCostMicro(t, messages, opts));
    if (!hold) { limited = true; continue; }
    let r: Awaited<ReturnType<Llm["generate"]>>;
    try {
      r = await llmFor(t, ctx.env).generate(messages, opts);
      if (!r.text?.trim()) throw new Error("empty answer");
    } catch (e) {
      await release(ctx.db, hold).catch(() => {});
      lastError = e;
      log.warn(`[coursemate-ai] ${t.provider}:${t.model} failed (${e instanceof Error ? e.message.slice(0, 200) : "error"})`);
      continue;
    }
    await meterQuietly(ctx, { userId: caller.id, target: t, job, tokensIn: r.tokensIn ?? promptTokens(messages), tokensOut: r.tokensOut ?? estimateTokens(r.text), fallback: i > 0, reserved: reserved || !countCall }, hold);
    if (leaked(r.text)) { lastError = withheld(caller, job); break; }
    return { text: r.text, target: t, limited: limited && !mana, mana };
  }
  if (lastError instanceof HttpError && lastError.code === "answer_withheld") throw lastError;   // answered (and metered), not shown
  if (reserved) await releaseCall(ctx.db, caller.id).catch(() => {});      // nobody answered: the call isn't spent
  if (sees && limited && lastError === undefined) throw imagesNeedBudget(caller);
  throw noModel();
}

/**
 * A streamed answer. Resolves once the first words have arrived (from whichever target managed it), so a failure
 * before that is an ordinary error. `pieces` then yields the rest; `done` resolves with the whole text (metered).
 * A stream that is never read to the end keeps its reservation until the day ends (the safe side).
 */
export async function stream(ctx: Ctx, caller: Caller, job: Job, raw: ChatMessage[], opts: CallOptions = {}) {
  const messages = withGuard(raw);
  const sees = hasImages(messages);
  const { list, reserved, scopes } = await targets(ctx, caller, job, sees);
  let limited = false;
  let failed = false;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const { hold, mana } = await holdFor(ctx, caller, scopes, worstCostMicro(t, messages, opts));
    if (!hold) { limited = true; continue; }
    let it: AsyncIterator<{ text?: string; tokensIn?: number; tokensOut?: number }>;
    let first: IteratorResult<{ text?: string; tokensIn?: number; tokensOut?: number }>;
    try {
      it = llmFor(t, ctx.env).stream(messages, opts)[Symbol.asyncIterator]();
      do { first = await it.next(); } while (!first.done && !first.value.text);
      if (first.done) throw new Error("empty answer");
    } catch (e) {
      await release(ctx.db, hold).catch(() => {});
      failed = true;
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
    const source = it;
    const held: Hold = hold;
    async function* pieces(): AsyncGenerator<string> {
      // the canary check: a tail that could be the start of the marker is held back until the next piece shows
      // what it is, so not even part of it goes out
      let sent = 0;
      const out = function* (final: boolean): Generator<string> {
        if (leaked(text)) throw withheld(caller, job);
        const upTo = final ? text.length : safeLength(text);
        if (upTo > sent) { yield text.slice(sent, upTo); sent = upTo; }
      };
      try {
        yield* out(false);
        for (;;) {
          const r = await source.next();
          if (r.done) break;
          if (r.value.text) { text += r.value.text; yield* out(false); }
          if (r.value.tokensIn !== undefined) tokensIn = r.value.tokensIn;
          if (r.value.tokensOut !== undefined) tokensOut = r.value.tokensOut;
        }
        yield* out(true);
        await meterQuietly(ctx, { userId: caller.id, target: t, job, tokensIn: tokensIn ?? promptTokens(messages), tokensOut: tokensOut ?? estimateTokens(text), fallback, reserved }, held);
        resolveDone({ text });
      } catch (e) {
        // what was said still counts: the provider charges for it
        await meterQuietly(ctx, { userId: caller.id, target: t, job, tokensIn: promptTokens(messages), tokensOut: estimateTokens(text), fallback, reserved }, held);
        rejectDone(e);
        throw e;
      }
    }
    return { target: t, pieces: pieces(), done, limited: limited && !mana, mana };
  }
  if (reserved) await releaseCall(ctx.db, caller.id).catch(() => {});
  if (sees && limited && !failed) throw imagesNeedBudget(caller);
  throw noModel();
}
