import re
import asyncio
import logging
from langchain_core.messages import SystemMessage, HumanMessage
from core_brains.llm_connection import generate_structured_async
from core_brains.llm_schemas import QuizBatch
from prompts.quiz_prompts import get_quiz_system, get_quiz_human

logger = logging.getLogger(__name__)

BATCH_SIZE = 4  # Max questions per LLM call — prevents Gemini/flash truncation
# Max concurrent batch requests. Keeps parallelism high while avoiding rate-limit spikes.
MAX_CONCURRENT_BATCHES = 3


# ─────────────────────────────────────────────────────────────────────────────
# One batch - the provider's native structured output; invalid questions are dropped by QuizQuestion's validators
# ─────────────────────────────────────────────────────────────────────────────

async def _generate_batch_async(
    count: int, question_type: str, context: str,
    system_msg: str, semaphore: asyncio.Semaphore
) -> list:
    """Ask the LLM for `count` questions asynchronously, respecting a concurrency semaphore."""
    async with semaphore:
        messages = [SystemMessage(content=system_msg), HumanMessage(content=get_quiz_human(count, question_type, context))]
        batch = await generate_structured_async(messages, QuizBatch, context={"question_type": question_type})
        return [q.model_dump() for q in batch.questions]


# ─────────────────────────────────────────────────────────────────────────────
# Sync entry point (legacy)
# ─────────────────────────────────────────────────────────────────────────────

def generate_quiz(context: str, num_questions: int, question_type: str) -> dict:
    """Sync version — delegates to async implementation via asyncio.run()."""
    return asyncio.get_event_loop().run_until_complete(
        generate_quiz_async(context, num_questions, question_type)
    )


# ─────────────────────────────────────────────────────────────────────────────
# Async entry point — fires all batches in parallel (up to MAX_CONCURRENT_BATCHES)
# ─────────────────────────────────────────────────────────────────────────────

async def generate_quiz_async(context: str, num_questions: int, question_type: str) -> dict:
    """
    Generate quiz questions with parallel batch requests.

    Instead of sequential LLM calls (each waiting on the previous), all batches
    are dispatched concurrently via asyncio.gather. For a 20-question quiz this
    reduces wall-clock time from ~5× to ~1× the slowest single batch.

    A semaphore caps concurrent in-flight requests to avoid rate-limit spikes.
    """
    system_msg = get_quiz_system(question_type)

    # Build the list of batch sizes (e.g. 20 questions → [4,4,4,4,4])
    batches: list[int] = []
    remaining = num_questions
    while remaining > 0 and len(batches) < 6:
        batches.append(min(remaining, BATCH_SIZE))
        remaining -= batches[-1]

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)

    logger.info(f"Generating {num_questions} questions in {len(batches)} parallel batches")
    results = await asyncio.gather(
        *[_generate_batch_async(b, question_type, context, system_msg, semaphore) for b in batches],
        return_exceptions=True,
    )

    all_questions: list = []
    for r in results:
        if isinstance(r, Exception):
            logger.warning(f"A quiz batch raised an exception: {r}")
        elif r:
            all_questions.extend(r)

    if not all_questions:
        raise ValueError("No questions could be generated. Please try again.")

    return merge_questions(all_questions, num_questions)


# ─────────────────────────────────────────────────────────────────────────────
# Putting the batches together
# ─────────────────────────────────────────────────────────────────────────────

def _question_key(text: str) -> str:
    """Normalised question text, used to drop duplicates produced by parallel batches."""
    return re.sub(r"\W+", " ", text.lower()).strip()


def merge_questions(questions: list, target_count: int) -> dict:
    """Validated questions from all batches -> the quiz: duplicates dropped (parallel batches don't see each other),
    at most `target_count`, ids renumbered from 1."""
    merged, seen = [], set()
    for q in questions:
        key = _question_key(q["question"])
        if key in seen:
            continue
        seen.add(key)
        merged.append({**q, "id": len(merged) + 1})
        if len(merged) >= target_count:
            break
    if not merged:
        raise ValueError("No valid questions could be parsed from the model response")
    return {"questions": merged}
