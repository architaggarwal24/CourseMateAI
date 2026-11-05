// What every study tool needs (Stage 4.4): the activity history, the cache of generated content, searching the
// document for a topic (and refusing a topic it doesn't cover), and asking a model for data (JSON) with one retry.
import { and, asc, desc, eq, lt, ne } from "drizzle-orm";
import type { RequestContext } from "../context";
import { activityLog, generationCache } from "../db/schema";
import { HttpError } from "../http";
import { searchDeps, searchPassages, type Passage } from "../search";
import { generate, type Caller, type CallOptions, type ChatMessage } from "../ai/run";
import type { Job } from "../ai/models";
import { BadAnswer } from "./schemas";
import { extractJson, questionKey } from "./text";

type Env = Record<string, string | undefined>;
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

// ── history ──────────────────────────────────────────────────────────────────────────────────────────────────
const sqliteNow = () => new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");

/** Log one action. History is a nice-to-have: a failed write never fails the request. */
export async function logActivity(ctx: RequestContext, userId: number, sessionId: string, mode: string, actionType: string, content: unknown) {
  if (mode === "arena") return;
  try {
    await ctx.db.insert(activityLog).values({ userId, sessionId: String(sessionId ?? ""), mode, actionType, content: JSON.stringify(content ?? {}), createdAt: sqliteNow() });
  } catch (e) {
    console.warn("[coursemate] history write failed", e instanceof Error ? e.message : e);
  }
}

const decode = (r: typeof activityLog.$inferSelect) => {
  let content: unknown = {};
  try { content = JSON.parse(r.content ?? "{}"); } catch { /* a corrupt row doesn't break the page */ }
  return { id: r.id, user_id: r.userId, session_id: r.sessionId, mode: r.mode, action_type: r.actionType, content, created_at: r.createdAt };
};

export async function userHistory(ctx: RequestContext, userId: number, mode?: string | null, limit = 100) {
  const n = Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 100, 500));
  const where = mode && mode !== "arena" ? and(eq(activityLog.userId, userId), eq(activityLog.mode, mode)) : and(eq(activityLog.userId, userId), ne(activityLog.mode, "arena"));
  const rows = await ctx.db.select().from(activityLog).where(where).orderBy(desc(activityLog.createdAt), desc(activityLog.id)).limit(n).all();
  return rows.map(decode);
}

export async function sessionHistory(ctx: RequestContext, userId: number, sessionId: string) {
  const rows = await ctx.db.select().from(activityLog)
    .where(and(eq(activityLog.userId, userId), eq(activityLog.sessionId, sessionId), ne(activityLog.mode, "arena")))
    .orderBy(asc(activityLog.createdAt), asc(activityLog.id)).all();
  return rows.map(decode);
}

// ── the cache of generated content ───────────────────────────────────────────────────────────────────────────
/** GENERATION_CACHE_DAYS (default 7; 0 = off). */
export const cacheDays = (env: Env = process.env) => Math.max(0, num(env.GENERATION_CACHE_DAYS, 7));

/** Everything the generated text depends on: kind, user, content hash, topic, options. */
export function cacheKey(kind: string, userId: number, docHash: string, topic: string, options: Record<string, unknown>): string {
  const opts = Object.keys(options).sort().map((k) => `${k}=${JSON.stringify(options[k])}`).join("&");
  return [kind, userId, docHash, questionKey(topic), opts].join("|");
}

export async function cacheGet<T>(ctx: RequestContext, key: string, now = new Date()): Promise<T | null> {
  if (!cacheDays()) return null;
  const row = await ctx.db.select().from(generationCache).where(eq(generationCache.key, key)).get();
  if (!row || row.expiresAt <= now.toISOString()) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}

export async function cachePut(ctx: RequestContext, userId: number, key: string, value: unknown, now = new Date()): Promise<void> {
  const days = cacheDays();
  if (!days) return;
  const expiresAt = new Date(now.getTime() + days * 86_400_000).toISOString();
  await ctx.db.insert(generationCache).values({ key, userId, value: JSON.stringify(value), expiresAt })
    .onConflictDoUpdate({ target: generationCache.key, set: { value: JSON.stringify(value), expiresAt } });
  // now and then, sweep what has expired
  if (Math.random() < 0.05) await ctx.db.delete(generationCache).where(lt(generationCache.expiresAt, now.toISOString()));
}

// ── a topic in the document ──────────────────────────────────────────────────────────────────────────────────
export interface Found { passages: Passage[]; context: string; sources: string[]; best: number | null }

export function requireSearch(ctx: RequestContext) {
  const deps = searchDeps(ctx.env);
  if (!deps) throw new HttpError(503, "search_unavailable", "Search isn't set up on this server yet (Workers AI and Vectorize).", "retry");
  return deps;
}

const label = (p: Passage) => (p.documentName && p.page ? `${p.documentName} · p.${p.page}` : p.documentName || (p.page ? `p.${p.page}` : ""));

export async function search(ctx: RequestContext, docs: { id: string; name: string }[], query: string, k: number): Promise<Found> {
  const passages = await searchPassages(ctx.db, requireSearch(ctx), docs, query, k);
  return {
    passages, context: passages.map((p) => p.text).join("\n\n"),
    sources: [...new Set(passages.map(label).filter(Boolean))],
    best: passages.length ? Math.max(...passages.map((p) => p.score)) : null,
  };
}

/** Search for `topic` and make sure the document really covers it, so a model is never asked to invent content. */
export async function findTopic(ctx: RequestContext, docs: { id: string; name: string }[], topic: string, k: number, minChars = 0): Promise<Found> {
  const found = await search(ctx, docs, topic, k);
  if (minChars && found.context.trim().length < minChars) {
    throw new HttpError(400, "topic_not_found", `Not enough content for '${topic}'. Try a topic from your document.`);
  }
  if (found.context.trim().length < 100) {
    throw new HttpError(400, "topic_not_found", `Topic '${topic}' was not found in your PDF. Please enter a topic that appears in the uploaded document.`);
  }
  if (found.best === null || found.best < num(process.env.TOPIC_MIN_SIMILARITY, 0.4)) {
    throw new HttpError(400, "topic_not_found", `Topic '${topic}' does not appear to be covered in your PDF. Try a topic from the document.`);
  }
  return found;
}

// ── data from a model ────────────────────────────────────────────────────────────────────────────────────────
export function generationFailed(message = "Something went wrong while generating that. Please try again."): HttpError {
  return new HttpError(500, "generation_failed", message, "retry");
}

/**
 * Ask for JSON and check it with `parse` (which throws BadAnswer for an unusable answer). An unusable answer is
 * asked for once more; a quota or plan error passes straight through.
 */
export async function generateData<T>(
  ctx: RequestContext, caller: Caller, job: Job, messages: ChatMessage[], parse: (data: unknown) => T,
  opts: CallOptions & { attempts?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 2;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    const { text } = await generate(ctx, caller, job, messages, { ...opts, json: true });
    try {
      return parse(extractJson(text));
    } catch (e) {
      if (!(e instanceof BadAnswer)) throw e;
      last = e;
      console.warn(`[coursemate-ai] unusable structured answer (${i + 1}/${attempts}): ${e.message}`);
    }
  }
  throw last instanceof Error ? last : new BadAnswer("unusable answer");
}

