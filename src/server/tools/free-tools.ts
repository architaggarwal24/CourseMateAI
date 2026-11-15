// The free tools on the public pages (SEO pass, stage 3): paste up to a page of notes, get flashcards, a short quiz or
// a summary, with no account. They are the pages that answer "make flashcards from my notes"-type searches, so they
// must really work, and because anyone can call them they are fenced in:
//   - input: 150 to 4,000 characters (a page of notes, not a book)
//   - FREE_TOOL_RUNS_PER_IP runs a day per visitor (default 5), FREE_TOOL_RUNS_PER_DAY for everyone (default 300)
//   - the fast model first, then the free Workers AI one; the fast one only while the free tools' daily budget and
//     the global spend cap both have room for its worst-case cost (ai/budget.ts, reserved before the call)
//   - the same prompt guard as the app (the notes are fenced as material; an answer with the canary is withheld)
//   - every call is in the AI cost report
// A run that no model managed is given back to the visitor and the daily total.
import * as log from "../log";
import type { RequestContext } from "../context";
import { HttpError, bumpCounter, clientIp, unbumpCounter, windowLeft } from "../http";
import { fenceMaterial, leaked, withGuard } from "../ai/guard";
import { estimateTokens, llmFor, noModel, type ChatMessage } from "../ai/run";
import { slotTarget, type Target } from "../ai/models";
import { loadLimits, meterAnonymous, release, reserve, toolScopes, worstCostMicro } from "../ai/budget";
import { extractJson } from "../study/text";

export const FREE_TOOLS = ["flashcards", "quiz", "summary"] as const;
export type FreeTool = (typeof FREE_TOOLS)[number];
export const MIN_CHARS = 150;
export const MAX_CHARS = 4000;
const DAY = 86_400;

const intEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
export const runsPerVisitor = () => intEnv("FREE_TOOL_RUNS_PER_IP", 5);
export const runsPerDay = () => intEnv("FREE_TOOL_RUNS_PER_DAY", 300);

export interface Flashcard { front: string; back: string }
export interface QuizItem { question: string; options: string[]; answer: number; explanation: string }
export interface Summary { title: string; points: string[]; terms: { term: string; meaning: string }[]; takeaway: string }

const JSON_ONLY = "Return ONLY valid JSON, with no preamble, explanation or markdown fences.";
const SYSTEM: Record<FreeTool, string> = {
  flashcards: `You write study flashcards from a student's notes. Write 8 flashcards covering the most important ideas.
Each has a short front (a question or term, at most 20 words) and a clear back (the answer, at most 50 words).
Use only what the notes say. ${JSON_ONLY}
Format: {"cards": [{"front": "...", "back": "..."}]}`,
  quiz: `You write a short multiple-choice quiz from a student's notes. Write 5 questions, each testing a different idea.
Each has exactly 4 plausible options prefixed "A. ", "B. ", "C. ", "D. ", one correct answer letter, and a one-sentence
explanation. Use only what the notes say; spread the correct answers across the letters. ${JSON_ONLY}
Format: {"questions": [{"question": "...?", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "correct_answer": "B", "explanation": "..."}]}`,
  summary: `You turn a student's notes into a quick revision summary: a title, 3 to 6 key points (one short sentence each),
up to 5 key terms with a one-line meaning, and a one-sentence takeaway. Use only what the notes say, in plain words. ${JSON_ONLY}
Format: {"title": "...", "points": ["..."], "terms": [{"term": "...", "meaning": "..."}], "takeaway": "..."}`,
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The model's answer as a clean result, or null when nothing usable came back. */
export function parseResult(tool: FreeTool, raw: unknown): { cards: Flashcard[] } | { questions: QuizItem[] } | { summary: Summary } | null {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (tool === "flashcards") {
    const cards = (Array.isArray(d.cards) ? d.cards : [])
      .map((c: Record<string, unknown>) => ({ front: str(c?.front, 200), back: str(c?.back, 400) }))
      .filter((c) => c.front && c.back).slice(0, 10);
    return cards.length ? { cards } : null;
  }
  if (tool === "quiz") {
    const questions = (Array.isArray(d.questions) ? d.questions : []).flatMap((q: Record<string, unknown>) => {
      const options = Array.isArray(q?.options) ? q.options.map((o) => str(o, 200).replace(/^[A-D][.)]\s*/, "")) : [];
      const answer = "ABCD".indexOf(str(q?.correct_answer, 2).toUpperCase().charAt(0));
      const question = str(q?.question, 300);
      if (!question || options.length !== 4 || options.some((o) => !o) || answer < 0) return [];
      return [{ question, options, answer, explanation: str(q?.explanation, 300) }];
    }).slice(0, 5);
    return questions.length ? { questions } : null;
  }
  const points = (Array.isArray(d.points) ? d.points : []).map((p) => str(p, 300)).filter(Boolean).slice(0, 8);
  if (!points.length) return null;
  const terms = (Array.isArray(d.terms) ? d.terms : [])
    .map((t: Record<string, unknown>) => ({ term: str(t?.term, 80), meaning: str(t?.meaning, 300) }))
    .filter((t) => t.term && t.meaning).slice(0, 8);
  return { summary: { title: str(d.title, 120) || "Summary", points, terms, takeaway: str(d.takeaway, 300) } };
}

const targets = (): Target[] => (["fast", "small"] as const).map((s) => slotTarget(s)).filter((t): t is Target => !!t);

/** POST /api/v1/tools/run {tool, text}: one free run. */
export async function runFreeTool(ctx: RequestContext, req: Request, body: Record<string, unknown>) {
  const tool = body.tool as FreeTool;
  if (!(FREE_TOOLS as readonly string[]).includes(tool)) throw new HttpError(400, "invalid_tool", "That tool doesn't exist.");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < MIN_CHARS) throw new HttpError(400, "text_too_short", `Paste at least ${MIN_CHARS} characters of notes: a few sentences or more.`);
  if (text.length > MAX_CHARS) throw new HttpError(400, "text_too_long", `The free tool takes up to ${MAX_CHARS.toLocaleString("en-IN")} characters (about a page). Sign up free to use whole PDFs.`);

  const ipKey = `free-tool:ip:${clientIp(req)}`;
  const allKey = "free-tool:all";
  const perVisitor = runsPerVisitor();
  const used = await bumpCounter(ctx.db, ipKey, DAY);
  if (used > perVisitor) {
    const retry = windowLeft(DAY);
    throw new HttpError(429, "rate_limited", `You've used today's ${perVisitor} free runs. Sign up free to keep going with your whole PDF, or come back tomorrow.`,
      "retry", { retry_after_seconds: retry }, { "retry-after": String(retry) });
  }
  if (await bumpCounter(ctx.db, allKey, DAY) > runsPerDay()) {
    await unbumpCounter(ctx.db, ipKey, DAY);
    throw new HttpError(429, "tools_busy", "The free tools are busy today. Sign up free to keep going, or try again tomorrow.", "retry");
  }

  const messages: ChatMessage[] = withGuard([
    { role: "system", content: SYSTEM[tool] },
    { role: "user", content: `The student's notes:\n${fenceMaterial(text)}` },
  ]);
  const list = targets();
  const scopes = toolScopes(await loadLimits(ctx.db));
  const opts = { json: true, temperature: 0.4, maxOutputTokens: 1400, timeoutMs: 30_000 };
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const hold = await reserve(ctx.db, scopes, worstCostMicro(t, messages, opts));
    if (!hold) continue;                                            // over a budget: the free model next
    try {
      let r: Awaited<ReturnType<ReturnType<typeof llmFor>["generate"]>>;
      try {
        r = await llmFor(t, ctx.env).generate(messages, opts);
      } catch (e) {
        await release(ctx.db, hold).catch(() => {});
        throw e;
      }
      await meterAnonymous(ctx.db, { target: t, job: "small", fallback: i > 0,
        tokensIn: r.tokensIn ?? estimateTokens(messages.map((m) => m.content).join("\n")), tokensOut: r.tokensOut ?? estimateTokens(r.text) }, hold);
      if (leaked(r.text)) {
        log.warn(`[coursemate-ai] ALERT canary in a free-tool answer: withheld (${tool})`);
        throw new HttpError(502, "answer_withheld", "That answer was withheld because it didn't follow the app's rules. Try different notes.", "retry");
      }
      const result = parseResult(tool, extractJson(r.text));
      if (!result) throw new Error("no usable result");
      return { tool, ...result, remaining: Math.max(0, perVisitor - used) };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      log.warn(`[coursemate-ai] free tool ${tool} on ${t.provider}:${t.model} failed (${e instanceof Error ? e.message.slice(0, 200) : "error"})`);
    }
  }
  await unbumpCounter(ctx.db, ipKey, DAY);
  await unbumpCounter(ctx.db, allKey, DAY);
  throw noModel();
}
