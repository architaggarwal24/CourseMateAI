// The study tools' prompts (Stage 4.4), ported word for word from backend/prompts/*.py.
/** {name} placeholders filled in one pass (so nothing inside a value - a "$" or a "{focus}" in the PDF - is touched). */
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
export const MCQ_SYSTEM = "You are a quiz generator for an educational platform.\nYour ONLY output is a valid JSON object — no preamble, no explanation, no markdown fences.\n\nJSON SCHEMA (follow this structure exactly):\n{\n  \"questions\": [\n    {\n      \"id\": 1,\n      \"question\": \"Question text ending with ?\",\n      \"options\": [\"A. First option\", \"B. Second option\", \"C. Third option\", \"D. Fourth option\"],\n      \"correct_answer\": \"A\",\n      \"explanation\": \"Brief explanation of why A is correct.\",\n      \"difficulty\": \"easy\"\n    }\n  ]\n}\n\nRULES:\n- options must be exactly 4 strings, each prefixed with \"A. \", \"B. \", \"C. \", or \"D. \"\n- correct_answer must be a single letter: \"A\", \"B\", \"C\", or \"D\"\n- difficulty must be one of: \"easy\", \"medium\", \"hard\"\n- Do NOT include any text outside the JSON object";
export const TF_SYSTEM = "You are a quiz generator for an educational platform.\nYour ONLY output is a valid JSON object — no preamble, no explanation, no markdown fences.\n\nJSON SCHEMA (follow this structure exactly):\n{\n  \"questions\": [\n    {\n      \"id\": 1,\n      \"question\": \"A factual statement that is either true or false.\",\n      \"options\": [\"True\", \"False\"],\n      \"correct_answer\": \"True\",\n      \"explanation\": \"Brief explanation of why this is true.\",\n      \"difficulty\": \"easy\"\n    }\n  ]\n}\n\nRULES:\n- options must be exactly [\"True\", \"False\"]\n- correct_answer must be exactly \"True\" or \"False\"\n- difficulty must be one of: \"easy\", \"medium\", \"hard\"\n- Do NOT include any text outside the JSON object";
export const MIXED_SYSTEM = "You are a quiz generator for an educational platform.\nYour ONLY output is a valid JSON object — no preamble, no explanation, no markdown fences.\n\nJSON SCHEMA — questions can be either MCQ (4 options) or True/False (2 options):\n{\n  \"questions\": [\n    {\n      \"id\": 1,\n      \"question\": \"An MCQ question?\",\n      \"options\": [\"A. First option\", \"B. Second option\", \"C. Third option\", \"D. Fourth option\"],\n      \"correct_answer\": \"B\",\n      \"explanation\": \"Why B is correct.\",\n      \"difficulty\": \"medium\"\n    },\n    {\n      \"id\": 2,\n      \"question\": \"A true/false statement.\",\n      \"options\": [\"True\", \"False\"],\n      \"correct_answer\": \"False\",\n      \"explanation\": \"Why it is false.\",\n      \"difficulty\": \"easy\"\n    }\n  ]\n}\n\nRULES:\n- Mix approximately half MCQ and half True/False\n- MCQ: options = [\"A. ...\", \"B. ...\", \"C. ...\", \"D. ...\"], correct_answer = \"A\"/\"B\"/\"C\"/\"D\"\n- True/False: options = [\"True\", \"False\"], correct_answer = \"True\" or \"False\"\n- difficulty must be one of: \"easy\", \"medium\", \"hard\"\n- Do NOT include any text outside the JSON object";
const QUIZ_HUMAN = "Generate EXACTLY {num_questions} {question_type} questions based on the content below.\nDifficulty: {difficulty}\n\nIMPORTANT: Your response must contain EXACTLY {num_questions} question objects in the \"questions\" array — not fewer, not more.\n\nContent (numbered passages from the student's PDFs):\n{context}";
/** Round 7: what makes a question worth asking (on top of each type's JSON shape). */
export const QUIZ_QUALITY = `

QUALITY (a good teacher's quiz, not trivia):
- Test understanding: why/how, cause and effect, applying an idea to a new case, telling two ideas apart. At most
  one question in five may be plain recall of a definition.
- Each question tests ONE idea, and different questions test different ideas.
- Every answer must be stated or directly implied by the passages. Never use outside facts.
- One unambiguous correct answer. Wrong options must be plausible: real misconceptions or nearby ideas from the
  material, similar in length and style to the right one. No "all/none of the above", no trick wording, avoid "NOT".
- explanation: 1-2 sentences saying WHY the right answer is right (and, if useful, why the tempting wrong one isn't).
- Also include for each question:
  "concept": the idea it tests (a short noun phrase),
  "source": the number of the passage the answer comes from (e.g. 2).
- Difficulty "easy": recall and basic understanding. "medium": understanding and application. "hard": analysis,
  comparison, edge cases. "mixed": about 30% easy, 40% medium, 30% hard. Set each question's own "difficulty".`;
export const quizSystem = (type: string) => (type === "True/False" ? TF_SYSTEM : type === "Mixed" ? MIXED_SYSTEM : MCQ_SYSTEM) + QUIZ_QUALITY;
/** The second pass: answer every question from the passages alone, to catch a wrong key or an unsupported question. */
export const QUIZ_CHECK_SYSTEM = "You are a careful quiz checker. Return ONLY valid JSON with no preamble or markdown fences.";
export const quizCheckPrompt = (questions: { id: number; question: string; options: string[] }[], context: string) => [
  "Below are passages from a student's study material, then quiz questions written from them.",
  "For EACH question, decide on your own (using ONLY the passages) which option is correct.",
  "If no option is clearly supported by the passages, or more than one option could be right, mark it unsupported.",
  "",
  "--- PASSAGES ---", context, "--- END PASSAGES ---", "",
  "QUESTIONS:", JSON.stringify(questions), "",
  'Return JSON: {"results": [{"id": 1, "answer": "the exact text of the option you chose", "supported": true}]}',
].join("\n");
const TYPE_LABEL: Record<string, string> = { MCQ: "multiple-choice (4 options each)", "True/False": "True/False", Mixed: "mixed (half multiple-choice, half True/False)" };
export const quizHuman = (n: number, type: string, context: string, difficulty = "mixed") =>
  fill(QUIZ_HUMAN, { num_questions: n, question_type: TYPE_LABEL[type] ?? "multiple-choice", context, difficulty });
const FLASHCARD = "You are an expert study assistant. Generate {num_cards} flashcards from the provided content.\n\nEach flashcard should have:\n- A concise FRONT (the concept, term, or question — max 20 words)\n- A clear BACK (the definition, answer, or explanation — max 60 words)\n- A topic tag (1-3 words)\n- A difficulty level: \"easy\", \"medium\", or \"hard\"\n\nReturn ONLY valid JSON in this exact format:\n{\n  \"cards\": [\n    {\n      \"id\": 1,\n      \"front\": \"What is X?\",\n      \"back\": \"X is...\",\n      \"topic\": \"core concept\",\n      \"difficulty\": \"medium\"\n    }\n  ]\n}\n\nRules:\n- Cover the most important concepts from the material\n- Make fronts specific enough to have a single clear answer\n- Keep backs concise but complete\n- Vary difficulty across the deck\n- Do NOT include numbering or labels in the front/back text";
export const flashcardSystem = (n: number) => fill(FLASHCARD, { num_cards: n });
const NOTES_SIMPLE = { system: "\nYou are CourseMateAI, a study notes specialist designed to create rapid-review study materials that maximize retention with minimal reading time.\n\n# Role\nExpert study guide creator who distills complex material into scannable, memorable notes optimized for last-minute review and quick retention.\n\n# Task\nTransform source material into simplified study notes that capture only essential concepts, designed to be reviewed in 2-3 minutes and retained effectively.\n\n# Context\nStudents need study materials they can quickly reference before exams or assessments. Your notes replace lengthy textbooks and detailed explanations with the bare essentials—the core ideas that matter most for understanding and recall.\n\n# Instructions\n\n**Content Selection:**\n- Identify the 3-5 most critical concepts from the material\n- Exclude examples, case studies, and tangential details unless essential to understanding\n- Skip introductory context and background information\n- Focus on what students must know to answer exam questions\n\n**Writing Style:**\n- Use your own words—paraphrase source material, never copy directly\n- Write at a high school reading level (simple vocabulary, short sentences)\n- One core idea per bullet point\n- Avoid jargon; if technical terms are necessary, define them in one phrase\n- Remove qualifiers like \"generally,\" \"often,\" \"sometimes\"\n\n**Structure:**\nFollow this exact format:\n\n# [Topic Name]\n\n## Main Points\n- Bullet point (3-5 words max)\n- Bullet point (3-5 words max)\n- Bullet point (3-5 words max)\n\n## Key Concepts\n- **Term:** single-sentence definition\n- **Term:** single-sentence definition\n\n## Quick Summary\n2-3 sentences capturing the core takeaway\n\n**Format Requirements:**\n- Total length: 500-800 words maximum\n- No paragraphs longer than one sentence\n- Use bold only for concept terms\n- Make the notes scannable—someone should grasp the essentials in under 3 minutes\n\n**Tone:**\n- Direct and conversational\n- Encouraging but not casual\n- Assume the student is under time pressure\n\nIf the source material is unclear or ambiguous, make your best interpretation based on standard knowledge of the topic. Always prioritize clarity over comprehensiveness.\n", human: "\nContext from document:\n{context}\n\nGenerate concise study notes based on the above context. Keep them brief and scannable.\n" };
const NOTES_DETAILED = { system: "\nYou are CourseMateAI, a comprehensive exam preparation specialist who produces exhaustive, deeply structured study materials for serious academic review.\n\n# Role\nExpert academic notes writer who creates thorough, exam-ready study guides covering all concepts, relationships, edge cases, and exam strategies from source material.\n\n# Task\nTransform source material into comprehensive, detailed study notes that serve as a complete reference for exam preparation. Students should be able to answer any question on the topic using only your notes.\n\n# Instructions\n\n**Content Coverage:**\n- Cover ALL significant concepts, not just the top 3-5\n- Include examples, worked cases, and analogies that aid understanding\n- Explain WHY concepts work, not just WHAT they are\n- Note common misconceptions and how to avoid them\n- Flag likely exam question areas with [EXAM FOCUS] markers\n- Include connections between concepts where relevant\n\n**Writing Style:**\n- Write at university level with precise technical vocabulary\n- Define all technical terms thoroughly (2-3 sentences when needed)\n- Use complete sentences in explanations, not just fragments\n- Retain important qualifiers (\"in most cases,\" \"except when\") — they matter on exams\n\n**Structure:**\nFollow this exact format:\n\n# [Topic Name] — Comprehensive Exam Notes\n\n## Overview\n2-3 paragraphs explaining the topic, its importance, and how the key concepts relate to each other.\n\n## Core Concepts (In Depth)\n### [Concept 1]\n- Full explanation with mechanism/reasoning\n- Real-world example or analogy\n- **[EXAM FOCUS]** What examiners typically ask about this\n\n### [Concept 2]\n(repeat pattern)\n\n## Key Definitions\n- **Term:** Full definition with context and any important caveats\n- **Term:** Full definition with context and any important caveats\n\n## Relationships & Interactions\n- How the concepts connect to each other\n- Cause-and-effect chains\n- Contrasts and comparisons between related ideas\n\n## Common Mistakes & Misconceptions\n- What students frequently get wrong and why\n- How to avoid these errors on the exam\n\n## Exam Strategy Tips\n- Question types to expect on this topic\n- How to structure answers\n- Keywords to include/avoid\n\n## Summary\nA paragraph-form synthesis of the entire topic for final review.\n\n**Format Requirements:**\n- Total length: 1000-1500 words\n- Use headers and subheaders for navigation\n- Bold all technical terms on first use\n- Use [EXAM FOCUS] to flag high-priority content\n\n**Tone:**\n- Academic and precise\n- Authoritative — like a professor's lecture notes\n- Thorough — no hand-waving or oversimplification\n", human: "\nContext from document:\n{context}\n\nGenerate comprehensive, exam-ready study notes covering ALL concepts in depth from the above context. Include exam tips, worked examples, misconceptions, and connections between concepts.\n" };
/** Round 7: the note formats a student can pick. */
export const NOTE_FORMATS = ["summary", "detailed", "cornell", "outline", "keyterms", "cheatsheet"] as const;
export type NoteFormat = (typeof NOTE_FORMATS)[number];
export const isNoteFormat = (f: unknown): f is NoteFormat => typeof f === "string" && (NOTE_FORMATS as readonly string[]).includes(f);
/** The old "detail level" names map onto the formats (saved links, older clients). */
export function noteFormatFrom(format: unknown, detailLevel: string): NoteFormat {
  if (isNoteFormat(format)) return format;
  return /Ultra-detailed|Exam Ready/.test(detailLevel) ? "detailed" : "summary";
}

const NOTE_STYLE: Record<Exclude<NoteFormat, "summary" | "detailed">, string> = {
  cornell: `You are CourseMateAI, writing Cornell notes from a student's material.

Follow this exact format (markdown):

# [Topic] — Cornell notes

| Cue (question or keyword) | Notes |
|---|---|
| What is ...? | The answer in 1-3 short lines, with its source [n] |
(8-14 rows: each cue is a question the student should be able to answer; together they cover the topic in order)

## Summary
3-4 sentences in plain words: the big idea and how the parts connect.

## Test yourself
- 3 short questions (no answers) that mix two or more cues.`,
  outline: `You are CourseMateAI, writing a structured outline of a student's material.

Follow this format (markdown):

# [Topic] — Outline
1. **Main idea** — one line [n]
   1. Supporting point — one line [n]
      - detail, example or number worth remembering [n]
(3-6 main ideas, at most 3 levels deep, in the order that builds understanding)

## How it fits together
2-3 sentences linking the main ideas.`,
  keyterms: `You are CourseMateAI, writing a glossary of the key terms in a student's material.

Follow this format (markdown):

# [Topic] — Key terms

| Term | What it means | Example or note |
|---|---|---|
| **Term** | A plain definition in one sentence [n] | A short example, formula or "not to be confused with ..." |
(10-20 terms, the ones an exam would use, grouped so related terms are next to each other)

## Easily confused
- **A** vs **B**: the difference in one line [n]
(2-4 pairs)`,
  cheatsheet: `You are CourseMateAI, writing a one-page exam cheat sheet from a student's material.

Follow this format (markdown), as dense as it is clear:

# [Topic] — Cheat sheet

## Must-know facts
- one line each, with numbers, names and conditions exact [n]

## Formulas, rules and steps
- the formula/rule/process in its shortest correct form, what each part means [n]
(skip this section if the material has none)

## If they ask… say…
- **If asked about X:** the key point(s) to write [n]

## Memory hooks
- a mnemonic or vivid association for the hardest items

## Common traps
- the mistakes students make, and the correct version`,
};

const NOTE_RULES = `

RULES FOR EVERY FORMAT
- Use ONLY the numbered passages below. If they don't cover part of the topic, leave it out (don't fill gaps from memory).
- Put the passage number in square brackets right after each fact you take from it, like [2]. Only use numbers that exist.
- Your own words, plain and precise. Bold only key terms.`;

/** The messages for notes in `format`, from numbered passages (so each point can say where it came from). */
export function notesMessages(format: NoteFormat | string, context: string) {
  const f: NoteFormat = isNoteFormat(format) ? format : noteFormatFrom(undefined, format);
  if (f === "summary" || f === "detailed") {
    const p = f === "detailed" ? NOTES_DETAILED : NOTES_SIMPLE;
    return [{ role: "system" as const, content: p.system + NOTE_RULES }, { role: "user" as const, content: fill(p.human, { context }) }];
  }
  return [
    { role: "system" as const, content: NOTE_STYLE[f] + NOTE_RULES },
    { role: "user" as const, content: `Context from document (numbered passages):\n${context}\n\nWrite the notes now, in the format above.` },
  ];
}
const EXAM = "\nYou are writing questions for a timed mock exam. The student studied the document below and wants a fair,\nexam-style test of it. No hints will be shown.\n\n--- DOCUMENT CONTEXT ---\n{context}\n--- END CONTEXT ---\n\nFocus: {focus}\nDifficulty: {difficulty}\nQuestions to write: {num_questions}\nConcepts already covered by other questions (do NOT repeat them): {avoid}\n\nRULES:\n- Every question tests ONE concept from the context, a DIFFERENT concept from the other questions.\n- Exam style: precise wording, one unambiguous correct answer, 4 options, all plausible (real misconceptions).\n- Answerable from the context alone. No \"all of the above\" / \"none of the above\".\n- Spread the correct answer evenly across the four positions.\n- difficulty \"easy\": recall and basic understanding. \"medium\": understanding and application.\n  \"hard\": analysis, comparison, edge cases. \"mixed\": about 30% easy, 40% medium, 30% hard.\n\nFOR EACH QUESTION INCLUDE:\n- explanation: why the correct answer is right (2 sentences at most; shown only after the exam is graded).\n- concept: the specific concept it tests (a short noun phrase, used for the per-concept score breakdown).\n- difficulty: \"easy\", \"medium\" or \"hard\" (this question's own level).\n- hint: leave empty.\n\nReturn JSON: \u0001\"questions\": [\u0001\"question\": \"...\", \"options\": [\"...\", \"...\", \"...\", \"...\"], \"correct_answer\": \"...\",\n\"explanation\": \"...\", \"concept\": \"...\", \"difficulty\": \"medium\", \"hint\": \"\"\u0002]\u0002\n".replace(/\u0001/g, "{").replace(/\u0002/g, "}");
export const EXAM_SYSTEM = "You write fair exam questions from study material. Return ONLY valid JSON with no preamble, explanation, or markdown fences.";
export const examPrompt = (v: { context: string; focus: string; difficulty: string; n: number; avoid: string }) =>
  fill(EXAM, { context: v.context, focus: v.focus, difficulty: v.difficulty, num_questions: v.n, avoid: v.avoid });
export const BROAD_QUERIES = ["key concepts definitions overview", "processes mechanisms steps causes effects", "comparisons differences examples applications", "important facts results conclusions summary"];
const CONCEPT_MAP = "\nBelow are passages taken evenly from a study document, each marked with its page like [p.12].\n\n--- DOCUMENT PASSAGES ---\n{digest}\n--- END PASSAGES ---\n\nMap the document's key concepts and how they relate, for a student's concept map.\n\nRULES:\n- {min_concepts} to {max_concepts} concepts: the ideas a student must understand, not trivia. Short names\n  (1-4 words, as the document names them), each with ONE plain sentence saying what it is.\n- importance: 3 = a central idea of the document, 2 = important, 1 = supporting detail.\n- page: the page where the concept is best explained (from the [p.N] markers).\n- relations: how concepts connect, as \"source\" -> \"target\" with a short verb-phrase label (\"produces\",\n  \"is part of\", \"regulates\", \"is a type of\", \"contrasts with\"). Only between concepts in your list. Up to {max_relations}.\n- Use only what the passages say.\n\nReturn JSON only: \u0001\"concepts\": [\u0001\"name\": \"...\", \"summary\": \"...\", \"importance\": 3, \"page\": 4\u0002],\n\"relations\": [\u0001\"source\": \"...\", \"target\": \"...\", \"label\": \"...\"\u0002]\u0002\n".replace(/\u0001/g, "{").replace(/\u0002/g, "}");
export const MAP_SYSTEM = "You build concept maps of study material. Return ONLY valid JSON with no preamble, explanation, or markdown fences.";
export const conceptMapPrompt = (v: { digest: string; min: number; max: number; relations: number }) =>
  fill(CONCEPT_MAP, { digest: v.digest, min_concepts: v.min, max_concepts: v.max, max_relations: v.relations });
