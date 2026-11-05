// A follow-up question turned into a standalone search query (the TypeScript port of
// backend/core_brains/query_rewriter.py). "Why does it happen in prophase?" finds nothing on its own; with the
// last few turns it becomes "Why does chromosome condensation happen in prophase?".
// The model is NOT asked when there is no conversation yet, or the question already names its topic. When it is
// asked (a small job), a failure never fails the chat: the previous question is searched together with this one.
import type { ChatMessage } from "../ai/run";

const MAX_TURN_CHARS = 400;
const MAX_QUERY_CHARS = 400;
const ANAPHORA = new Set(["it", "its", "they", "them", "their", "theirs", "this", "that", "these", "those", "he", "she", "him", "her",
  "his", "hers", "former", "latter", "above", "previous", "earlier", "same", "another", "others"]);
const LEAD_INS = new Set(["and", "but", "so", "also", "then", "plus", "or", "meaning", "okay", "ok", "wait",
  "elaborate", "continue", "again", "more", "next", "example", "examples", "simplify"]);
const LEAD_PHRASES = ["what about", "how about", "what else", "can you explain", "could you explain", "explain more", "tell me more",
  "go on", "give me an example", "give an example", "any example", "in more detail", "can you elaborate", "could you elaborate"];
const FILLER = new Set(["a", "an", "the", "is", "are", "was", "were", "be", "been", "do", "does", "did", "can", "could", "would",
  "should", "will", "what", "why", "how", "when", "where", "who", "which", "whom", "whose", "of", "in", "on", "to",
  "for", "with", "as", "at", "by", "from", "about", "me", "my", "you", "your", "i", "we", "tell", "explain",
  "please", "so", "yes", "no", "mean", "means", "meant", "work", "works", "happen", "happens", "get", "gets"]);

export const SYSTEM_PROMPT =
  "You rewrite a student's latest question so it can be understood WITHOUT the conversation.\n" +
  "- Replace pronouns and references (it, they, that, the second one, ...) with what they refer to, using the conversation.\n" +
  "- Keep the meaning and the language of the question. Do not answer it. Do not add facts.\n" +
  "- If the question is already standalone, return it unchanged.\n" +
  "Output ONLY the rewritten question on a single line.";

export function isSelfContained(question: string): boolean {
  const words = (question.match(/[a-zA-Z']+/g) ?? []).map((w) => w.toLowerCase());
  if (!words.length) return false;
  const text = words.join(" ");
  if (LEAD_INS.has(words[0]) || LEAD_PHRASES.some((p) => text.startsWith(p))) return false;
  if (words.some((w) => ANAPHORA.has(w))) return false;
  return words.some((w) => !FILLER.has(w));
}

export interface Turn { role: "user" | "assistant"; content: string }

export function fallbackQuery(question: string, history: Turn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user" && history[i].content) return `${history[i].content.slice(0, MAX_TURN_CHARS)} ${question}`.trim();
  }
  return question;
}

function clean(raw: string): string {
  const line = (raw || "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const out = line.replace(/^\s*(?:the\s+)?(?:standalone|rewritten|reformulated)\s+question\s*[:\-]\s*/i, "")
    .trim().replace(/^["'`“”‘’ ]+|["'`“”‘’ ]+$/g, "").trim();
  return out && out.length <= MAX_QUERY_CHARS ? out : "";
}

export function rewriteMessages(question: string, recent: Turn[]): ChatMessage[] {
  const convo = recent.map((t) => `${t.role === "user" ? "Student" : "Tutor"}: ${t.content.slice(0, MAX_TURN_CHARS)}`).join("\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Conversation:\n${convo}\n\nLatest question: ${question}\n\nStandalone question:` },
  ];
}

export interface Rewrite { query: string; method: "skipped" | "llm" | "fallback" }

export async function standaloneQuestion(
  question: string, history: Turn[], ask: (messages: ChatMessage[]) => Promise<string>,
  { enabled = true, maxMessages = 6 }: { enabled?: boolean; maxMessages?: number } = {},
): Promise<Rewrite> {
  const recent = history.filter((t) => t.content).slice(-maxMessages);
  if (!enabled || !recent.length || isSelfContained(question)) return { query: question, method: "skipped" };
  let rewritten = "";
  try {
    rewritten = clean(await ask(rewriteMessages(question, recent)));
  } catch { /* quota, outage...: the answer call reports it */ }
  return rewritten ? { query: rewritten, method: "llm" } : { query: fallbackQuery(question, recent), method: "fallback" };
}
