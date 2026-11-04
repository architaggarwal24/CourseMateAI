"""Prompt for exam mode: a mock test written from the student's document (core_brains/exam_brain.py)."""

EXAM_PROMPT = """
You are writing questions for a timed mock exam. The student studied the document below and wants a fair,
exam-style test of it. No hints will be shown.

--- DOCUMENT CONTEXT ---
{context}
--- END CONTEXT ---

Focus: {focus}
Difficulty: {difficulty}
Questions to write: {num_questions}
Concepts already covered by other questions (do NOT repeat them): {avoid}

RULES:
- Every question tests ONE concept from the context, a DIFFERENT concept from the other questions.
- Exam style: precise wording, one unambiguous correct answer, 4 options, all plausible (real misconceptions).
- Answerable from the context alone. No "all of the above" / "none of the above".
- Spread the correct answer evenly across the four positions.
- difficulty "easy": recall and basic understanding. "medium": understanding and application.
  "hard": analysis, comparison, edge cases. "mixed": about 30% easy, 40% medium, 30% hard.

FOR EACH QUESTION INCLUDE:
- explanation: why the correct answer is right (2 sentences at most; shown only after the exam is graded).
- concept: the specific concept it tests (a short noun phrase, used for the per-concept score breakdown).
- difficulty: "easy", "medium" or "hard" (this question's own level).
- hint: leave empty.

Return JSON: {{"questions": [{{"question": "...", "options": ["...", "...", "...", "..."], "correct_answer": "...",
"explanation": "...", "concept": "...", "difficulty": "medium", "hint": ""}}]}}
"""

# What to search for when the student picked no topics: different angles, so the batches cover the document.
BROAD_QUERIES = (
    "key concepts definitions overview",
    "processes mechanisms steps causes effects",
    "comparisons differences examples applications",
    "important facts results conclusions summary",
)
