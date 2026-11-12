// The public feature pages (SEO P1, round 7): one page per real, shipped capability, written from what the app does
// today (checked against the code: src/server/account/plans.ts for plans, src/server/study/* and src/server/game/* for
// behaviour). No invented numbers, reviews, users or outcomes. When a feature changes, change its page here.
// Plan names come from the plan catalogue, so a page never claims a feature on the wrong plan.
import { FEATURES, TIER_NAMES } from "../account/plan-tiers";

export interface FeatureSection { h2: string; text: string; points?: string[] }
export interface FeaturePage {
  slug: string;
  /** <title> (the template adds "| CourseMateAI"). */
  title: string;
  /** A short name for links and the hub's cards. */
  h1Short: string;
  description: string;
  h1: string;
  lede: string;
  /** What the illustration on the page shows (see components/landing/FeatureArt.tsx). */
  art: "tutor" | "quiz" | "review" | "game";
  sections: FeatureSection[];
  /** Which plan has what (only when part of the page is on a paid plan). */
  plan?: string;
  faq: { q: string; a: string }[];
}

const plan = (f: keyof typeof FEATURES) => TIER_NAMES[FEATURES[f]];

export const FEATURE_PAGES: FeaturePage[] = [
  {
    slug: "ai-tutor",
    h1Short: "AI tutor",
    title: "AI tutor for your PDFs: chat, notes and concept maps",
    description: "Ask questions about your own course PDFs and get answers that cite the page, notes in six formats, and a concept map of how the ideas connect.",
    h1: "An AI tutor that has read your course notes",
    lede: "Upload your lecture slides, chapters and past papers into a course. Your tutor answers from that material, shows the page each point came from, and tells you when your PDFs don't cover something.",
    art: "tutor",
    sections: [
      {
        h2: "Answers from your material, with the page",
        text: "Every answer is built from the passages it finds in your PDFs, and each point carries a numbered marker for the page it came from. If your material doesn't cover a question, the answer is labelled as a general explanation rather than passed off as yours.",
        points: [
          "Ask about one PDF, or a whole course of PDFs at once",
          "Numbered page markers on every point, with a list of sources under the answer",
          `On ${plan("pdf_viewer")} and up, a source opens the PDF at its page with the passage highlighted`,
          "Suggested follow-up questions after each answer",
        ],
      },
      {
        h2: "Four ways to be taught",
        text: "Switch how the tutor teaches at any time; the next answer follows it.",
        points: [
          "Explain: clear explanations with examples",
          "Guide me: leads you to the answer with questions and hints instead of handing it over",
          "Quiz me: one question at a time from your material, then feedback",
          "Simplify: plain words and one everyday analogy, then the one-line exam version",
        ],
      },
      {
        h2: "Notes in six formats",
        text: "Pick a topic and a format, and get notes written from your PDFs, with page links on the facts. They keep generating if you switch to another tool while you wait.",
        points: [
          "Summary, Exam-ready, Cornell, Outline, Key terms or Cheat sheet",
          "An outline view to jump between sections",
          "Download as Markdown or text, print or save as PDF, or copy",
          "Every set of notes is saved to your history",
        ],
      },
      {
        h2: "A concept map of your course",
        text: `On ${plan("concept_map")} and up, the concept map lays out the main ideas in your PDFs as a mind map, coloured by how well you know each one. Open any concept to start a quick quiz, flashcards or a boss fight on it.`,
      },
    ],
    plan: `Chat and notes are on every plan, including the free one. The concept map and the PDF page viewer come with ${plan("concept_map")}.`,
    faq: [
      { q: "Does it make things up?", a: "It answers from the passages it finds in your PDFs and marks each point with its page. When your material doesn't cover the question, the answer says so and is labelled as a general explanation." },
      { q: "What files can I use?", a: "PDFs with real text: lecture slides, book chapters, notes exported to PDF. Scanned pages without a text layer can't be read yet." },
      { q: "Who can see my PDFs?", a: "Only you. Your files are private to your account, and you can delete any of them, or your whole account, at any time." },
    ],
  },
  {
    slug: "quizzes-flashcards-exams",
    h1Short: "Quizzes, flashcards and exams",
    title: "Quizzes, flashcards and mock exams from your notes",
    description: "Practice questions written from your own PDFs: quizzes graded one by one with explanations, flashcards, and timed mock exams with a report.",
    h1: "Practice questions written from your own notes",
    lede: "Quizzes, flashcards and mock exams are made from the PDFs in your course, so you practise what your teacher actually covered, not generic questions.",
    art: "quiz",
    sections: [
      {
        h2: "Quizzes, graded as you go",
        text: "Choose a topic, a question type and a difficulty. Each answer is checked straight away, with an explanation and the part of your material it comes from.",
        points: [
          "Multiple choice, true/false or a mix",
          "Easy (key facts), medium (understand and apply), hard or mixed",
          "Retry just the questions you missed, with the options shuffled",
          "A summary at the end of the concepts you're weakest on",
        ],
      },
      {
        h2: "Flashcards",
        text: "Make between 5 and 30 cards on a topic, flip through them and mark what you knew. You can also turn the questions you got wrong in quizzes and the arena into a deck.",
      },
      {
        h2: "Timed mock exams",
        text: `On ${plan("exam_mode")} and up, take a timed exam across your course: 10, 20 or 30 questions, with no hints until it's graded. The report shows how you did on each concept, and every miss is added to your review queue.`,
        points: ["Easy, medium, hard or mixed", "60 to 90 seconds a question, depending on the difficulty", "Optionally focus on up to five topics"],
      },
    ],
    plan: `Quizzes and flashcards are on every plan, including the free one. Mock exams come with ${plan("exam_mode")}.`,
    faq: [
      { q: "Are the answers checked by the AI or by the app?", a: "Each quiz question's answer is decided when the quiz is written and checked against your material in a second pass. When you answer, the server grades it; the correct answer isn't sent to your browser before you answer." },
      { q: "Can I practise a whole course at once?", a: "Yes. Quizzes, flashcards and exams can use one PDF or every PDF in a course." },
    ],
  },
  {
    slug: "spaced-repetition",
    h1Short: "Spaced-repetition review",
    title: "Spaced-repetition review for what you study",
    description: "A daily review that brings each card back just before you'd forget it, using the FSRS scheduler, with cards from your flashcards and missed questions.",
    h1: "A daily review that brings cards back before you forget",
    lede: "Spaced repetition shows you a card again just as you're about to forget it. CourseMateAI keeps one review queue for everything you study and schedules it with FSRS, an open-source spaced-repetition algorithm.",
    art: "review",
    sections: [
      {
        h2: "Where the cards come from",
        text: "You don't have to write cards by hand: they join your queue as you study.",
        points: [
          "Flashcards you study (the first grade counts as the first review)",
          "Questions you miss in quizzes, mock exams and arena fights",
          "One queue across all your PDFs, with a filter for the one you're on",
        ],
      },
      {
        h2: "How a review works",
        text: "Read the question, show the answer, then say how well you knew it. Each choice shows how long until you'll see the card again.",
        points: [
          "Again, Hard, Good or Easy, from the keyboard (Space, then 1 to 4) or by tapping",
          "Up to 20 new cards a day, so the queue never floods",
          "Remove a card you don't need; it only comes back if you miss that question again",
          "The number due shows in the navigation, so you know when to come back",
        ],
      },
    ],
    plan: `The review queue comes with ${plan("review_queue")} and up.`,
    faq: [
      { q: "What is FSRS?", a: "The Free Spaced Repetition Scheduler, an open-source algorithm that estimates when you're likely to forget each card. CourseMateAI uses it with its default settings, aiming for 90% recall." },
      { q: "Do I lose cards if I skip a day?", a: "No. Overdue cards wait in the queue, most overdue first." },
    ],
  },
  {
    slug: "study-game",
    h1Short: "The study game",
    title: "A study game: boss fights built from your notes",
    description: "Turn revision into a pixel RPG: boss fights where every question comes from your PDFs, champions, a Bestiary, daily quests, streaks and a daily chest.",
    h1: "Boss fights where every question comes from your notes",
    lede: "The Hero area turns what you study into a game. Pick a champion and fight creatures from myth: every question in a fight is from your course, so a right answer is a hit and a wrong one is a lesson.",
    art: "game",
    sections: [
      {
        h2: "Fights that test what you studied",
        text: "Choose a topic from your PDFs and a difficulty; a creature is summoned to guard it. Each turn you pick a move, and the move decides the question.",
        points: [
          "Strike, Jab (a quick, easier question), Heavy (a harder question for a bigger hit) or Guard",
          "Easy, medium, hard or nightmare (a creature's Elder form)",
          "Nemesis: a boss built from the concepts you keep getting wrong (after at least three)",
          "Expedition: a run across a map of fights, with relics and one life",
        ],
      },
      {
        h2: "Champions and the Bestiary",
        text: "Six champions, each with their own passive and ultimate, level up as you fight with them; some join you as you progress. The Bestiary is an old book of 13 creatures in four tiers: beat two creatures of a tier to break the seal on the next, and each page fills in with lore, tactics and your record against it.",
      },
      {
        h2: "A reason to come back each day",
        text: "Daily quests, a study streak and a daily chest reward studying, not just playing. Coins buy outfits, head pieces and potions for your champion; some give a small edge in fights, like extra time or a hint.",
      },
    ],
    plan: "The Hero area, its fights and champions are on every plan, including the free one.",
    faq: [
      { q: "Do I need to be good at games?", a: "No. A fight is won by answering questions right; your move decides how hard the next question is and how much it hits for." },
      { q: "Does playing count as studying?", a: "Every question comes from your own PDFs, and the ones you miss join your review queue (on plans with review), so a fight is practice too." },
    ],
  },
];

export const featureBySlug = (slug: string) => FEATURE_PAGES.find((f) => f.slug === slug);
export const featurePath = (slug: string) => `/features/${slug}`;
export const FEATURES_HUB = {
  path: "/features",
  title: "Features: AI study tools built on your own notes",
  description: "What CourseMateAI does: an AI tutor that cites your PDFs, notes, quizzes, flashcards, mock exams, spaced-repetition review and a study game.",
  h1: "Study tools built on your own notes",
};
