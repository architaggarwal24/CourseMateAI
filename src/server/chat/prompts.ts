// The tutor (round 7): a teacher who knows the student's course material, not a search box. It talks like a person,
// builds on the conversation, teaches in the mode the student picked, and stays honest: what comes from the PDFs is
// cited by passage number, anything it adds from general knowledge is said to be that, and it never invents a page.
import { fenceMaterial } from "../ai/guard";
import type { ChatMessage } from "../ai/run";
import type { Turn } from "./rewrite";

export const TUTOR_MODES = ["explain", "socratic", "quiz", "simplify"] as const;
export type TutorMode = (typeof TUTOR_MODES)[number];
export const isTutorMode = (m: unknown): m is TutorMode => typeof m === "string" && (TUTOR_MODES as readonly string[]).includes(m);

/** How well the course material covers the question (decides what the tutor is told to do). */
export type Coverage = "strong" | "weak" | "none" | "conversation";

export const TUTOR_PROMPT = `
You are the student's personal tutor in CourseMateAI: a brilliant, warm teacher who has read their course material
closely. You are talking with one student, in a real conversation. Teach the way the best teachers do.

HOW YOU TALK
- Like a person, not a manual. Vary how you start; never open with "Great question" or repeat the question back.
- Match the size of the answer to the question: a quick question gets a few sentences; a "why" or "how" gets a
  proper explanation. Use headings or tables only when they genuinely help (comparisons, steps, many parts).
- Build on the conversation: remember what you already explained and what the student got wrong or right; refer
  back to it ("like the ATP point earlier...").
- Use the student's words, then sharpen them. Give an example or an analogy when an idea is abstract.
- Bold the few key terms the student should remember. Keep paragraphs short.
- When it helps, end with ONE short check-for-understanding question or a natural next step. Not every time.
- If the student is frustrated or confused, slow down, reassure them briefly, and try a different angle.

STAYING TRUE TO THE MATERIAL
- The numbered passages are from the student's own PDFs. Base your answer on them and put the passage number in
  square brackets right after a sentence that uses it, like "ATP is made in the mitochondria [2]." Several: [1][3].
- Only cite numbers that appear in the passages. Never invent page numbers or quote what isn't there.
- You may add a little general knowledge to make an idea click (an everyday analogy, a common example), but say so
  ("Outside your notes, ..."), keep it short, and never contradict the passages.
- If the passages don't cover something, say that plainly and kindly, then help anyway as far as you honestly can.

AFTER YOUR ANSWER
On a new line write exactly "---", then 2 or 3 short questions the student might naturally ask next, one per line
starting with "- ". Make them specific to this conversation (not generic like "Tell me more").
`.trim();

const MODE_RULES: Record<TutorMode, string> = {
  explain: "MODE: Explain. Teach clearly and completely, with an example where it helps.",
  socratic: [
    "MODE: Socratic. Guide the student to work it out themselves. Do NOT hand over the full answer straight away.",
    "Ask one focused question at a time, give a small hint when they're stuck, and build on what they say.",
    "When they get there, confirm it warmly and sum it up in one or two sentences (with citations).",
    "If they explicitly ask for the answer, give it, then ask a question that checks they understood it.",
  ].join("\n"),
  quiz: [
    "MODE: Quiz me. You are quizzing the student on their material, one question at a time.",
    "If the student has just answered a question you asked, first say whether it's right, partly right or wrong, why,",
    "and the correct answer with citations. Then ask the next question.",
    "Otherwise ask a new question from the passages: vary the type (recall, why/how, apply it to a case, spot the mistake).",
    "Never put the answer in the same message as the question. Keep the question to one or two sentences.",
    "Instead of follow-up questions after \"---\", offer short replies the student might give, like \"- I'm not sure, give me a hint\".",
  ].join("\n"),
  simplify: [
    "MODE: Simplify. Explain as if to a bright 12-year-old: plain words, short sentences, one everyday analogy,",
    "no jargon unless you define it in a few words. Then give the one-line \"exam version\" of the idea.",
  ].join("\n"),
};

const COVERAGE_RULES: Record<Coverage, string> = {
  strong: "",
  weak: "The passages are only loosely related to the question. Use what is relevant; if the question is unclear, ask the student what they mean (and suggest what the material does cover).",
  none: "The student's material does not seem to cover this question (the passages below are the closest it has, and may be unrelated). Say so plainly first. Then, if it is a reasonable study question, give a short general explanation clearly marked as not from their PDFs, and suggest a related topic their material does cover. Don't cite passages that don't support what you say.",
  conversation: "This message is conversation, not a question about the material (a greeting, thanks, how you work, what to study). Reply naturally and briefly as their tutor, and offer a concrete way to start: a topic from their material, a quick quiz, or a summary.",
};

/** The subject in a line ("Biology 101: lecture-3.pdf, lab.pdf"). */
export function subjectLine(name: string, docs: string[]): string {
  const list = docs.slice(0, 6).join(", ") + (docs.length > 6 ? `, and ${docs.length - 6} more` : "");
  return docs.length > 1 || name !== docs[0] ? `${name} (${list})` : name;
}

/** System prompt (tutor + mode + coverage), the recent conversation, then the message with the passages. */
export function buildChatMessages(context: string, question: string, history: Turn[],
  opts: { mode?: TutorMode; coverage?: Coverage; subject?: string } = {}): ChatMessage[] {
  const mode = opts.mode ?? "explain";
  const coverage = opts.coverage ?? "strong";
  const recent = history.slice(-12).filter((t) => t.content);
  const system = [TUTOR_PROMPT, MODE_RULES[mode], COVERAGE_RULES[coverage], opts.subject ? `The student is studying: ${opts.subject}.` : ""]
    .filter(Boolean).join("\n\n");
  const user = coverage === "conversation"
    ? question
    : `Passages from the student's material:\n${context ? fenceMaterial(context) : "(none found)"}\n\nStudent: ${question}`;
  return [
    { role: "system", content: system },
    ...recent.map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    { role: "user", content: user },
  ];
}

// ── what kind of message it is ─────────────────────────────────────────────────────────────────────────────────
const SOCIAL = [
  /^(hi|hii+|hello|hey|heya|yo|hola|namaste|good (morning|afternoon|evening|night))\b[\s!.,]*(there|tutor|sir|ma'?am)?[\s!.]*$/i,
  /^(thanks|thank you|thx|ty|cheers|ok(ay)?|cool|nice|great|awesome|got it|makes sense|perfect|alright|sure|yes|yeah|no|nope|bye|see you)\b[\s!.,]*(so much|a lot|!)*[\s!.]*$/i,
  /^(who|what) are you\b/i, /^what can you do\b/i, /^how (do|does) (this|you) work\b/i, /^help\b[\s!.?]*$/i,
  /^(i'?m|i am) (bored|tired|stressed|confused|lost|nervous|anxious)\b/i,
];
/** A greeting, thanks, or a question about the tutor itself: answered without searching the material. */
export function isConversation(message: string): boolean {
  const m = message.trim();
  return m.length <= 80 && SOCIAL.some((re) => re.test(m));
}

const QUIZ_ASK = /^(quiz me|test me|ask me( a question| something)?|another( one| question)?|next( one| question)?|again|one more|go on|keep going|start|continue)\b/i;
/** In Quiz me, a request for (another) question rather than an answer to one. */
export const isQuizRequest = (message: string) => QUIZ_ASK.test(message.trim());
