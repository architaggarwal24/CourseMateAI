// The free tools (SEO pass, stage 3): public pages that do one study job right on the page, no account. Each answers
// a search people make when they want a tool ("AI flashcard maker", "quiz generator from notes"), so each must really
// work: three run on pasted notes (src/server/tools/free-tools.ts, a few runs a day), and the revision planner runs
// entirely in the browser. Every page has its own words: what it does, how, tips and questions.

export type ToolKind = "flashcards" | "quiz" | "summary" | "planner";
export interface ToolPage {
  slug: string;
  kind: ToolKind;
  /** When this page's words last really changed (the sitemap's lastmod). */
  updated: string;
  title: string;
  description: string;
  h1: string;
  /** The tool's short name (links, breadcrumbs). */
  name: string;
  lede: string;
  steps: string[];
  tips: string[];
  faq: { q: string; a: string }[];
}

/** Notes to try a tool with, one click (a short, accurate passage on a school topic). */
export const SAMPLE_NOTES = `Photosynthesis is the process by which green plants make their own food. It takes place mainly in the leaves, inside chloroplasts, which contain the green pigment chlorophyll. Chlorophyll absorbs light energy, mostly from sunlight. Using this energy, the plant combines carbon dioxide from the air with water from the soil to make glucose. Oxygen is released as a by-product. Carbon dioxide enters the leaf through tiny pores called stomata, which also let water vapour out. The overall equation is: carbon dioxide + water, in the presence of light and chlorophyll, gives glucose + oxygen. The glucose is used for energy in respiration or stored as starch. Without photosynthesis there would be no oxygen in the air for animals to breathe.`;

const NOTES_FAQ = [
  { q: "Is it really free?", a: "Yes. You can run it a few times a day without an account. A free account lets you do the same with whole PDFs, and keeps what you make." },
  { q: "What notes work best?", a: "Clear notes on one topic: a page of a textbook, your class notes, a chapter summary. The tool takes up to about a page (4,000 characters) at a time." },
  { q: "Are my notes saved?", a: "No. The notes you paste here are used to make the result and are not stored or added to any account." },
];

export const TOOL_PAGES: ToolPage[] = [
  {
    slug: "ai-flashcard-maker",
    kind: "flashcards",
    updated: "2026-11-14",
    title: "AI flashcard maker: turn your notes into flashcards, free",
    description: "Paste a page of notes and get eight flashcards to revise with, free and without an account. Flip each card to check yourself.",
    h1: "Turn your notes into flashcards",
    name: "Flashcard maker",
    lede: "Paste a page of notes and get eight flashcards on the ideas that matter. Flip each one to test yourself. Free, no account needed.",
    steps: [
      "Paste up to a page of notes: a textbook section, your class notes or a summary.",
      "Press Make flashcards. The AI picks the key ideas and writes a question and answer for each.",
      "Flip each card and say the answer out loud before you look. That is active recall, and it is what makes cards work.",
    ],
    tips: [
      "Paste one topic at a time; mixed notes give vaguer cards.",
      "Notes with definitions, processes and causes give the best cards.",
      "Review the cards again tomorrow and in three days. Spacing out reviews is what moves facts into long-term memory.",
    ],
    faq: [
      ...NOTES_FAQ,
      { q: "Can it make flashcards from a whole PDF?", a: "With a free account, yes: upload the PDF and CourseMateAI makes cards from any part of it, then brings them back for review on the right days." },
    ],
  },
  {
    slug: "quiz-generator",
    kind: "quiz",
    updated: "2026-11-14",
    title: "Quiz generator from notes: a free AI practice quiz",
    description: "Paste your notes and get a five-question multiple-choice quiz with answers and explanations. Free practice for any subject, no account.",
    h1: "Make a practice quiz from your notes",
    name: "Quiz generator",
    lede: "Paste a page of notes and get a five-question quiz, marked as you go, with a short explanation for every answer. Free, no account needed.",
    steps: [
      "Paste up to a page of notes on one topic.",
      "Press Make a quiz. The AI writes five multiple-choice questions, each on a different idea.",
      "Pick an answer for each question. You see straight away if it's right, and why.",
    ],
    tips: [
      "Take the quiz before you re-read your notes: testing yourself first shows what you really remember.",
      "Wrong answers are useful. Read the explanation, then try the quiz again tomorrow.",
      "For board exams, paste one chapter section at a time and quiz yourself on each.",
    ],
    faq: [
      ...NOTES_FAQ,
      { q: "Can I get longer quizzes or mock exams?", a: "With a free account you can make quizzes of up to 20 questions from your own PDFs, and timed mock exams with a score report." },
    ],
  },
  {
    slug: "notes-summarizer",
    kind: "summary",
    updated: "2026-11-14",
    title: "Notes summarizer: a free AI summary of your study notes",
    description: "Paste long notes and get a short revision summary: the key points, the key terms with meanings, and a one-line takeaway. Free, no account.",
    h1: "Summarise your notes for quick revision",
    name: "Notes summarizer",
    lede: "Paste a page of notes and get the key points, the terms to know and a one-line takeaway: a summary you can revise from in two minutes.",
    steps: [
      "Paste up to a page of notes or a textbook section.",
      "Press Summarise. The AI keeps the key points and the terms you need to know.",
      "Read the summary, then try to explain the topic without looking. If you can't, go back to that part of your notes.",
    ],
    tips: [
      "Summaries are for revising, not for learning a topic the first time: read the full notes once first.",
      "Turn each key term into a flashcard so it comes back for review.",
      "Check every point against your textbook; any AI can make mistakes.",
    ],
    faq: [
      ...NOTES_FAQ,
      { q: "Does it work for any subject?", a: "It works best for subjects with facts and explanations, like science, history and economics. For maths, it summarises the ideas, not worked solutions." },
    ],
  },
  {
    slug: "revision-planner",
    kind: "planner",
    updated: "2026-11-14",
    title: "Board exam revision planner: a free day-by-day study plan",
    description: "Enter your exam date and chapters and get a day-by-day revision plan with spaced reviews and a final week of mock tests. Free, works offline.",
    h1: "Plan your revision, day by day",
    name: "Revision planner",
    lede: "Enter your exam date and your chapters. You get a plan that spreads the chapters over the days you have, brings each one back for review, and leaves the last week for mock tests.",
    steps: [
      "Pick the date of your exam and list your chapters, one per line.",
      "Press Make my plan. Each chapter gets a day to study, then comes back for review a day, three days and a week later.",
      "Print the plan or keep the page open, and tick off each day as you go.",
    ],
    tips: [
      "Put the chapters you find hardest first, so they get the most reviews.",
      "Keep each day's study short and focused; the reviews do much of the work.",
      "Use the last week for timed papers under exam conditions, not new chapters.",
    ],
    faq: [
      { q: "Is it really free?", a: "Yes, and it runs entirely in your browser: nothing you type is sent anywhere." },
      { q: "Why does each chapter come back three times?", a: "Reviewing something just as you start to forget it (after a day, a few days, then a week) makes it last far longer than reading it again and again in one sitting. This is called spaced repetition." },
      { q: "What if I have very little time?", a: "The plan still fits every chapter in, studying more than one a day if it has to, and keeps at least a day or two for final review." },
      { q: "Can it remind me what to review?", a: "In CourseMateAI, yes: the cards from your own notes come back on the right days automatically, in a short daily review." },
    ],
  },
];

export const toolBySlug = (slug: string) => TOOL_PAGES.find((t) => t.slug === slug);
export const toolPath = (slug: string) => `/tools/${slug}`;
export const TOOLS_HUB = {
  path: "/tools",
  updated: "2026-11-14",
  title: "Free study tools: flashcards, quizzes, summaries and a revision planner",
  description: "Free tools for students: make flashcards, a practice quiz or a summary from your notes, and plan your board-exam revision day by day. No account.",
  h1: "Free study tools",
};
