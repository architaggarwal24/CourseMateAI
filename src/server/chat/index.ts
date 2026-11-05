// Chat on the Worker (Stage 4.3; the same flow as backend/routers/study.py):
//   the question is checked, a follow-up is rewritten into a standalone query (a small job), the document (or
//   course) is searched, the passages become numbered citations, and their best similarity decides:
//   below RELEVANCE_BLOCK_BELOW (0.30) the document doesn't cover it (no model call), below
//   RELEVANCE_CLARIFY_BELOW (0.45) the answer asks the student to clarify, else a normal answer (a strong job).
import type { CurrentUser, RequestContext } from "../context";
import { studyDocs } from "../documents";
import { HttpError } from "../http";
import { tierFor } from "../plans";
import { searchDeps, searchPassages, type Passage } from "../search";
import { generate, type Caller } from "../ai/run";
import { logActivity } from "../study/core";
import { onChatAnswered } from "../game/hooks";
import { buildChatMessages } from "./prompts";
import { standaloneQuestion, type Rewrite, type Turn } from "./rewrite";

export const MAX_QUESTION_CHARS = 2000;
const SNIPPET_CHARS = 220;
const QUOTE_CHARS = 1200;

type Env = Record<string, string | undefined>;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export function validateQuestion(q: unknown): string {
  const question = typeof q === "string" ? q.trim() : "";
  if (!question) throw new HttpError(400, "invalid_input", "Question cannot be empty", null, { field: "question" });
  if (question.length < 3) throw new HttpError(400, "invalid_input", "Question is too short", null, { field: "question" });
  if (question.length > MAX_QUESTION_CHARS) throw new HttpError(400, "invalid_input", `Question is too long (max ${MAX_QUESTION_CHARS} characters)`, null, { field: "question" });
  return question;
}

export function validateTopK(k: unknown, def = 5): number {
  if (k === undefined || k === null) return def;
  if (typeof k !== "number" || !Number.isInteger(k) || k < 1 || k > 20) throw new HttpError(400, "invalid_input", "top_k must be between 1 and 20");
  return k;
}

/** Only well-formed user/assistant turns, the last 20, each at most 4000 characters. */
export function sanitizeHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-20).flatMap((t) => {
    if (!t || typeof t !== "object") return [];
    const { role, content } = t as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    return [{ role, content: content.slice(0, 4000) }];
  });
}

export interface Citation { n: number; doc_id: string; doc_name: string | null; page: number | null; label: string; snippet: string; text: string }

export interface Retrieval { passages: Passage[]; citations: Citation[]; sources: string[]; best: number | null }

const norm = (t: string) => t.toLowerCase().split(/\s+/).filter(Boolean).join(" ");

/** Drop passages another (more relevant) one already contains, and number the rest as citations. */
export function toRetrieval(found: Passage[]): Retrieval {
  const kept: Passage[] = [];
  const seen: string[] = [];
  for (const p of found) {
    const text = norm(p.text);
    if (!text || seen.some((s) => s.includes(text))) continue;
    for (let i = seen.length - 1; i >= 0; i--) if (text.includes(seen[i])) { kept.splice(i, 1); seen.splice(i, 1); }
    kept.push(p);
    seen.push(text);
  }
  const citations = kept.map((p, i) => {
    const text = p.text.split(/\s+/).join(" ");
    const label = p.documentName && p.page ? `${p.documentName} · p.${p.page}` : p.documentName || (p.page ? `p.${p.page}` : "");
    return {
      n: i + 1, doc_id: p.documentId, doc_name: p.documentName || null, page: p.page || null, label,
      snippet: text.slice(0, SNIPPET_CHARS) + (text.length > SNIPPET_CHARS ? "…" : ""), text: text.slice(0, QUOTE_CHARS),
    };
  });
  return {
    passages: kept, citations, sources: [...new Set(citations.map((c) => c.label).filter(Boolean))],
    best: kept.length ? Math.max(...kept.map((p) => p.score)) : null,
  };
}

export function numberedContext(r: Retrieval): string {
  return r.citations.map((c) => `[${c.n}] (${c.label})\n${r.passages[c.n - 1].text}`).join("\n\n");
}

export function assessRelevance(r: Retrieval, env: Env = process.env) {
  const block = num(env.RELEVANCE_BLOCK_BELOW, 0.3);
  const clarify = num(env.RELEVANCE_CLARIFY_BELOW, 0.45);
  if (!r.passages.length || r.best === null) return { blocked: true, needs_clarification: false, reason: "insufficient_content" };
  if (r.best < block) return { blocked: true, needs_clarification: false, reason: "not_in_document" };
  if (r.best < clarify) return { blocked: false, needs_clarification: true, reason: "weak_match" };
  return { blocked: false, needs_clarification: false, reason: "strong_match" };
}

export const blockedText = (question: string) => `I cannot find "${question}" in the uploaded PDF.`;

export interface ChatPlan {
  question: string;
  history: Turn[];
  found: Retrieval;
  quality: ReturnType<typeof assessRelevance>;
  rewrite: Rewrite;
  caller: Caller;
  sessionId: string;
  tz: string | null;
}

export async function callerFor(ctx: RequestContext, user: CurrentUser): Promise<Caller> {
  return { id: user.id, owner: user.owner, tier: await tierFor(ctx.db, user) };
}

export async function planChat(ctx: RequestContext, user: CurrentUser, body: Record<string, unknown>): Promise<ChatPlan> {
  const question = validateQuestion(body.question);
  const topK = validateTopK(body.top_k);
  const history = sanitizeHistory(body.history);
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const study = await studyDocs(ctx, user, sessionId);
  // logged first, so the history reads question -> answer and keeps the question even if the answer fails
  await logActivity(ctx, user.id, study.id, "chat", "query", { question });
  const deps = searchDeps(ctx.env);
  if (!deps) throw new HttpError(503, "search_unavailable", "Search isn't set up on this server yet (Workers AI and Vectorize).", "retry");
  const caller = await callerFor(ctx, user);
  const rewrite = await standaloneQuestion(question, history,
    async (messages) => (await generate(ctx, caller, "small", messages, { maxOutputTokens: 120, temperature: 0 })).text,
    { enabled: (process.env.QUERY_REWRITE ?? "true") !== "false", maxMessages: num(process.env.QUERY_REWRITE_TURNS, 6) });
  const found = toRetrieval(await searchPassages(ctx.db, deps, study.docs, rewrite.query, topK));
  return { question, history, found, quality: assessRelevance(found), rewrite, caller, sessionId: study.id, tz: user.row.timezone ?? null };
}

/** The messages for the answer (when it isn't blocked). */
export function answerMessages(plan: ChatPlan) {
  const context = plan.quality.needs_clarification
    ? `The following content was found:\n\n${numberedContext(plan.found)}\n\nIf relevant, explain it. Otherwise, ask the user to clarify.`
    : numberedContext(plan.found);
  return buildChatMessages(context, plan.question, plan.history);
}

/** The answer joins the history (blocked questions have no answer to log). */
export async function logAnswer(ctx: RequestContext, plan: ChatPlan, answer: string) {
  const content = plan.quality.needs_clarification ? { answer, needs_clarification: true } : { answer, sources: plan.found.sources.length };
  await logActivity(ctx, plan.caller.id, plan.sessionId, "chat", "response", content);
}

export function finalPayload(plan: ChatPlan, blocked = false, rewards: unknown = null) {
  return {
    mode: "chat", sources: blocked ? [] : plan.found.sources, citations: blocked ? [] : plan.found.citations,
    blocked, needs_clarification: plan.quality.needs_clarification, rewards,
  };
}

/** The answer joins the history, and a real question counts for quests and the chat bundle (its rewards). */
export async function afterAnswer(ctx: RequestContext, plan: ChatPlan, answer: string) {
  await logAnswer(ctx, plan, answer);
  return onChatAnswered(ctx, { id: plan.caller.id, tz: plan.tz }, plan.question, plan.quality.needs_clarification);
}
