// Small text helpers the study tools share (Stage 4.4; ports of backend/core_brains/json_utils.py and friends):
// comparison keys, answer matching, and tolerant JSON extraction from a model's answer.
import { HttpError } from "../http";

export const MAX_TOPIC_CHARS = 200;

/** Normalised text: lower case, every run of non-word characters one space. Duplicate checks and keys. */
export const questionKey = (text: string) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, " ").trim();

const norm = (text: unknown) => [...String(text ?? "").normalize("NFKC").toLowerCase()].filter((c) => /[\p{L}\p{N}]/u.test(c)).join("");

/** Same answer, ignoring case, spacing and punctuation (any script). */
export function sameAnswer(a: unknown, b: unknown): boolean {
  const na = norm(a), nb = norm(b);
  if (na || nb) return na === nb;
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

export function validateTopic(topic: unknown, field = "topic"): string {
  const t = typeof topic === "string" ? topic.trim() : "";
  if (!t) throw new HttpError(400, "invalid_input", "Topic is required", null, { field });
  if (t.length > MAX_TOPIC_CHARS) throw new HttpError(400, "invalid_input", `Topic is too long (max ${MAX_TOPIC_CHARS} characters)`, null, { field });
  return t;
}

export function cleanText(v: unknown, limit: number, squash = false): string {
  const s = String(v ?? "");
  return (squash ? s.split(/\s+/).filter(Boolean).join(" ") : s.trim()).slice(0, limit);
}

// ── JSON from a model's answer ───────────────────────────────────────────────────────────────────────────────
const FENCE = /```[ \t]*(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)```/g;
const TRAILING_COMMA = /,\s*([}\]])/g;

function loads(text: string): unknown {
  try { return JSON.parse(text); } catch { return JSON.parse(text.replace(TRAILING_COMMA, "$1")); }
}

/** The first complete JSON value at the start of `text` (like Python's raw_decode), or throws. */
function rawDecode(text: string): unknown {
  let depth = 0, inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(0, i + 1));
      if (depth < 0) break;
    }
  }
  throw new Error("incomplete");
}

/** A response cut off mid-way: drop the unfinished tail and close what is still open. Null when nothing is left. */
export function closeOpenStructures(text: string): string | null {
  const stack: string[] = [];
  let inString = false, escaped = false;
  let lastSafe: [number, string] | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (!stack.length) return null;
      stack.pop();
      if (stack.length) lastSafe = [i + 1, [...stack].reverse().join("")];
    } else if (ch === "," && stack.length) lastSafe = [i, [...stack].reverse().join("")];
  }
  if (!stack.length) return text;
  if (!lastSafe) return null;
  return text.slice(0, lastSafe[0]) + lastSafe[1];
}

/**
 * The first JSON object/array in a model's answer, or null. Handles a bare document, ```json fences, prose around
 * it, trailing commas, and an answer cut off part-way (the complete items before the cut are kept).
 */
export function extractJson(text: string): unknown {
  const t = (text ?? "").trim();
  if (!t) return null;
  const candidates = [t, ...[...t.matchAll(FENCE)].map((m) => m[1].trim())];
  for (const c of candidates) {
    try { return loads(c); } catch { /* next */ }
  }
  for (const c of candidates) {
    for (const m of c.matchAll(/[{[]/g)) {
      const snippet = c.slice(m.index).replace(TRAILING_COMMA, "$1");
      try { return rawDecode(snippet); } catch { /* repair */ }
      const repaired = closeOpenStructures(snippet);
      if (repaired) {
        try { return JSON.parse(repaired); } catch { /* next */ }
      }
    }
  }
  return null;
}

// ── answer options ───────────────────────────────────────────────────────────────────────────────────────────
// "A. ", "B) ", "(C) ", "D: " or "A - ": the separator AND whitespace, so "B-cell" or "A deterministic…" aren't labels.
const LABEL = /^\s*\(?([A-Da-d])(?:[.):]\s+|\s+[-–—]\s+)/;

/** Remove "A. " style labels, only when the options are labelled A, B, C, D… in order. */
export function stripOptionPrefixes(options: unknown[]): string[] {
  const opts = options.map((o) => String(o));
  const letters: string[] = [];
  for (const o of opts) {
    const m = LABEL.exec(o);
    if (!m) return opts.map((x) => x.trim());
    letters.push(m[1].toUpperCase());
  }
  if (letters.join() !== opts.map((_, i) => String.fromCharCode(65 + i)).join()) return opts.map((x) => x.trim());
  return opts.map((o) => o.replace(LABEL, "").trim());
}

/** The option `answer` stands for ("B", "B. text", the text itself, …), or null when it can't be told. */
export function normalizeCorrectAnswer(answer: unknown, options: string[], questionType = "MCQ"): string | null {
  const a = String(answer ?? "").trim();
  if (!a || !options.length) return null;
  if (questionType === "True/False" || (options.length === 2 && options[0] === "True" && options[1] === "False")) {
    const low = a.toLowerCase().replace(/^[ .!]+|[ .!]+$/g, "");
    if (["true", "t", "yes", "a", "1"].includes(low) || low.startsWith("true")) return "True";
    if (["false", "f", "no", "b", "2"].includes(low) || low.startsWith("false")) return "False";
    return null;
  }
  if (options.includes(a)) return a;
  if (a.length === 1 && "ABCD".includes(a.toUpperCase())) return options[a.toUpperCase().charCodeAt(0) - 65] ?? null;
  const m = LABEL.exec(a);
  if (m) return options[m[1].toUpperCase().charCodeAt(0) - 65] ?? null;
  const stripped = stripOptionPrefixes(options);
  const body = stripOptionPrefixes([a])[0].toLowerCase().trim();
  if (body) {
    const exact = options.find((_, i) => stripped[i].toLowerCase().trim() === body);
    if (exact) return exact;
    const hits = options.filter((_, i) => {
      const s = stripped[i].toLowerCase();
      return s.trim() && (s.includes(body) || body.includes(s));
    });
    if (hits.length === 1) return hits[0];
  }
  return null;
}

export const newId = () => crypto.randomUUID().replace(/-/g, "");
export const stamp = (d: Date = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
