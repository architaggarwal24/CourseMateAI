// The arena's AI calls (port of the model half of backend/core_brains/boss_brain.py): battle questions (filed by
// tier), the boss's topic flavour (a small job) and an Expedition's acts. A model never decides a fight.
import type { RequestContext } from "../context";
import type { Caller } from "../ai/run";
import { generateData, search } from "../study/core";
import { BadAnswer } from "../study/schemas";
import { normalizeCorrectAnswer } from "../study/text";
import { CREATURES } from "./bestiary";
import { actsPrompt, battleQuizPrompt, flavorPrompt, nemesisBlock, RIDDLE } from "./arena-prompts";

type Docs = { id: string; name: string }[];
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const strList = (v: unknown) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : []).map(text).filter(Boolean);

const TIER_ALIASES: Record<string, string> = { easy: "easy", beginner: "easy", simple: "easy", medium: "medium", normal: "medium",
  intermediate: "medium", hard: "hard", nightmare: "hard", expert: "hard", advanced: "hard" };
/** The tier (easy / medium / hard) a battle question is filed under; anything else lands on the nearest one. */
export const questionTier = (v: unknown, d = "medium") => TIER_ALIASES[text(v).toLowerCase()] ?? TIER_ALIASES[text(d).toLowerCase()] ?? "medium";

/** The search context for a topic: its passages plus a broader "key concepts" search. */
export async function topicContext(ctx: RequestContext, docs: Docs, topic: string, k = 8): Promise<string> {
  const [a, b] = await Promise.all([search(ctx, docs, topic, k), search(ctx, docs, `key concepts ${topic}`, 4)]);
  return [...a.passages, ...b.passages].map((p) => p.text).filter((t, i, all) => all.indexOf(t) === i).join("\n\n");
}

export interface BattleQuestion { id: string; question: string; options: string[]; correct_answer: string; explanation: string; hint: string; concept: string; difficulty: string; riddle?: boolean }

export function battleQuiz(data: unknown, difficulty: string): BattleQuestion[] {
  const list = data && typeof data === "object" && Array.isArray((data as { questions?: unknown }).questions) ? (data as { questions: unknown[] }).questions : [];
  const out: BattleQuestion[] = [];
  list.forEach((raw) => {
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { options?: unknown }).options)) return;
    const o = raw as Record<string, unknown>;
    const options = (o.options as unknown[]).map(String);
    const question = text(o.question);
    if (!question || options.length < 2) return;
    const mapped = normalizeCorrectAnswer(text(o.correct_answer), options);
    if (mapped === null) return;
    const i = out.length;
    out.push({
      id: text(o.id) || `q${i + 1}_${1000 + Math.floor(Math.random() * 9000)}`, question, options, correct_answer: mapped,
      explanation: text(o.explanation) || "Review this concept in the material.", hint: text(o.hint) || "Think carefully about the key concepts.",
      concept: text(o.concept) || `concept_${i + 1}`, difficulty: questionTier(o.difficulty, difficulty), ...(o.riddle === true ? { riddle: true } : {}),
    });
  });
  if (!out.length) throw new BadAnswer("no usable battle questions");
  return out;
}

export async function generateBattleQuiz(ctx: RequestContext, caller: Caller, docs: Docs, o: {
  topic: string; difficulty: string; n: number; asked: string[]; phase: number; targets?: string[]; riddles?: boolean;
  /** Extra search words, so batches written side by side read different passages (and ask about different things). */
  angle?: string;
}): Promise<BattleQuestion[]> {
  const targets = (o.targets ?? []).map((t) => String(t).trim()).filter(Boolean);
  const asked = targets.length ? [] : o.asked;
  const query = [targets.length ? targets.join(" ") : o.topic, o.angle ?? ""].join(" ").trim();
  const context = (await topicContext(ctx, docs, query, o.difficulty === "hard" ? 10 : 8)).slice(0, 5000);
  const prompt = battleQuizPrompt({
    context, topic: o.topic, difficulty: o.difficulty, phase: o.phase, asked: asked.length ? asked.join(", ") : "None yet", n: o.n,
    targetBlock: (targets.length ? nemesisBlock(targets.map((t) => `- ${t}`).join("\n")) : "") + (o.riddles ? RIDDLE : ""),
  });
  return generateData(ctx, caller, "strong", [
    { role: "system", content: "You are a quiz generator for an educational battle game. Return ONLY valid JSON with no preamble, explanation, or markdown fences." },
    { role: "user", content: prompt },
  ], (d) => battleQuiz(d, o.difficulty), { temperature: 0.7, maxOutputTokens: 6000 });
}

/** ONE small call for the boss's topic lines (title, attacks, a few taunts). Throws on any failure. */
export async function bossFlavor(ctx: RequestContext, caller: Caller, docs: Docs, species: string, topic: string) {
  const c = CREATURES[species] ?? CREATURES.hydra;
  const context = (await topicContext(ctx, docs, topic, 5)).slice(0, 2500);
  return generateData(ctx, caller, "small", [
    { role: "system", content: "You write short boss dialogue for an educational game. Return ONLY valid JSON." },
    { role: "user", content: flavorPrompt({ creature: c.name, origin: c.origin, topic, context }) },
  ], (d) => {
    const o = d && typeof d === "object" ? (d as Record<string, unknown>) : null;
    if (!o) throw new BadAnswer("no flavour");
    const out: Record<string, unknown> = {};
    for (const k of ["title", "conceptual_core", "weakness", "special_ability", "intro_taunt", "defeat_taunt"]) { const v = text(o[k]).slice(0, 200); if (v) out[k] = v; }
    for (const k of ["attack_names", "hit_taunts", "miss_taunts"]) { const v = strList(o[k]).map((x) => x.slice(0, 120)).slice(0, 4); if (v.length) out[k] = v; }
    return out;
  }, { attempts: 1, temperature: 0.8, maxOutputTokens: 800, timeoutMs: 45_000 });
}

/** The `n` chapters an Expedition goes through, in reading order; fewer usable acts are repeated in order. */
export async function expeditionActs(ctx: RequestContext, caller: Caller, docs: Docs, n = 3): Promise<{ title: string; topic: string }[]> {
  const context = (await topicContext(ctx, docs, "chapters sections overview introduction summary", 12)).slice(0, 6000);
  const acts = await generateData(ctx, caller, "strong", [
    { role: "system", content: "You are a level designer for an educational roguelite. Return ONLY valid JSON with no preamble, explanation, or markdown fences." },
    { role: "user", content: actsPrompt(context, n) },
  ], (d) => {
    const list = d && typeof d === "object" && Array.isArray((d as { acts?: unknown }).acts) ? (d as { acts: unknown[] }).acts : [];
    const out = list.flatMap((a) => {
      const o = a && typeof a === "object" ? (a as Record<string, unknown>) : {};
      const topic = text(o.topic).slice(0, 100);
      return topic ? [{ title: text(o.title).slice(0, 100) || topic, topic }] : [];
    });
    if (!out.length) throw new BadAnswer("no usable expedition acts");
    return out;
  }, { temperature: 0.5 });
  return Array.from({ length: n }, (_, i) => acts[i % acts.length]);
}
