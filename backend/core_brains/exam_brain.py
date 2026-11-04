"""Exam mode question writing (Phase 3 Stage 3A): a mock test from the student's document.

The questions come in batches of up to BATCH questions, written in parallel. Each batch reads a different part of
the document - one per chosen topic, or a different broad angle when no topic was chosen - and is told which
concepts the batches before it cover, so the test spreads over the material. Duplicates are dropped.
"""
import asyncio
import logging
import re
from typing import List, Optional

from langchain_core.messages import HumanMessage, SystemMessage

from core_brains.boss_brain import _get_context_async
from core_brains.llm_connection import generate_structured_async
from core_brains.llm_schemas import BattleQuiz, question_key
from prompts.exam_prompts import BROAD_QUERIES, EXAM_PROMPT

logger = logging.getLogger(__name__)

BATCH = 10
CONTEXT_CHARS = 6000


def _plan(length: int, topics: List[str]) -> List[tuple]:
    """[(focus, search query, n)] - how many questions each batch writes, and from which part of the document."""
    sizes, left = [], length
    while left > 0:
        sizes.append(min(BATCH, left))
        left -= sizes[-1]
    if topics:                                   # one batch per topic when that fits, otherwise topics share batches
        n = max(len(sizes), min(len(topics), length))
        sizes = [length // n + (1 if i < length % n else 0) for i in range(n)]
        return [(topics[i % len(topics)], topics[i % len(topics)], s) for i, s in enumerate(sizes) if s]
    return [("the whole document", BROAD_QUERIES[i % len(BROAD_QUERIES)], s) for i, s in enumerate(sizes)]


async def generate_exam_async(vector_store, *, length: int, difficulty: str, topics: Optional[List[str]] = None) -> List[dict]:
    """Up to `length` distinct exam questions (dicts with question, options, correct_answer, explanation, concept,
    difficulty). May return fewer when the model drops some; the caller decides what is enough."""
    topics = [t for t in (topics or []) if t]
    plan = _plan(length, topics)

    async def batch(focus: str, query: str, n: int, avoid: List[str]) -> List[dict]:
        context = (await _get_context_async(vector_store, query, k=10))[:CONTEXT_CHARS]
        messages = [
            SystemMessage(content="You write fair exam questions from study material. "
                                  "Return ONLY valid JSON with no preamble, explanation, or markdown fences."),
            HumanMessage(content=EXAM_PROMPT.format(context=context, focus=focus, difficulty=difficulty,
                                                    num_questions=n, avoid=", ".join(avoid) or "None")),
        ]
        quiz = await generate_structured_async(messages, BattleQuiz)
        return quiz.finalize("medium")["questions"]

    # the batches run together; each is told the topics the others focus on, so they don't overlap
    results = await asyncio.gather(*[batch(f, q, n, [p[0] for p in plan if p[0] != f][:8]) for f, q, n in plan],
                                   return_exceptions=True)
    out, seen = [], set()
    for r in results:
        if isinstance(r, Exception):
            logger.warning(f"exam batch failed: {r}")
            continue
        for q in r:
            key = question_key(q.get("question", ""))
            if not key or key in seen or q.get("correct_answer") not in (q.get("options") or []):
                continue
            seen.add(key)
            lvl = str(q.get("difficulty") or "medium").lower()
            concept = (q.get("concept") or "").strip()[:200]
            if not concept or re.fullmatch(r"concept_\d+", concept):              # the schema's placeholder
                concept = "General"
            out.append({"question": q["question"], "options": list(q["options"]), "correct_answer": q["correct_answer"],
                        "explanation": q.get("explanation") or "", "concept": concept,
                        "difficulty": lvl if lvl in ("easy", "medium", "hard") else "medium"})
    if not out and results and all(isinstance(r, Exception) for r in results):
        raise results[0]
    return out[:length]
