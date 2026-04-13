from core_brains.json_utils import _normalize_correct_answer
import json
import re
import asyncio
import logging
from langchain_core.messages import SystemMessage, HumanMessage
from core_brains.llm_connection import ask_llm, ask_llm_async
from prompts.quiz_prompts import get_quiz_system, get_quiz_human

logger = logging.getLogger(__name__)

BATCH_SIZE = 4  # Max questions per LLM call — prevents Gemini/flash truncation
# Max concurrent batch requests. Keeps parallelism high while avoiding rate-limit spikes.
MAX_CONCURRENT_BATCHES = 3


def _extract_complete_question_objects(text: str) -> list:
    """
    Pull out complete question JSON objects from potentially truncated text.
    Uses bracket counting so we only return objects that are fully closed.
    """
    questions = []
    i = 0
    while i < len(text):
        start = text.find('{', i)
        if start == -1:
            break
        depth = 0
        end = start
        for j in range(start, len(text)):
            if text[j] == '{':
                depth += 1
            elif text[j] == '}':
                depth -= 1
                if depth == 0:
                    end = j
                    break
        if depth != 0:
            break
        obj_str = text[start:end + 1]
        obj_str = re.sub(r',\s*([}\]])', r'\1', obj_str)
        try:
            obj = json.loads(obj_str)
            if isinstance(obj, dict) and 'question' in obj and 'options' in obj:
                questions.append(obj)
        except json.JSONDecodeError:
            pass
        i = end + 1
    return questions


def safe_json_extract(text: str) -> dict:
    if not text:
        raise ValueError("Empty response")

    text = re.sub(r'```json\s*', '', text)
    text = re.sub(r'```\s*', '', text)
    cleaned = re.sub(r',\s*([}\]])', r'\1', text)

    match = re.search(r'\{[\s\S]*\}', cleaned)
    if match:
        try:
            data = json.loads(match.group())
            if data.get("questions"):
                return data
        except json.JSONDecodeError:
            pass

    questions = _extract_complete_question_objects(text)
    if questions:
        logger.warning(f"Truncated JSON detected — recovered {len(questions)} complete question(s)")
        return {"questions": questions}

    raise ValueError("No JSON found")


# ─────────────────────────────────────────────────────────────────────────────
# Sync batch (kept for backwards-compat / non-async callers)
# ─────────────────────────────────────────────────────────────────────────────

def _generate_batch(count: int, question_type: str, context: str, system_msg: str) -> list:
    """Ask the LLM for `count` questions synchronously."""
    human_msg = get_quiz_human(count, question_type, context)
    raw = ask_llm([SystemMessage(content=system_msg), HumanMessage(content=human_msg)])
    try:
        result = safe_json_extract(raw)
        return result.get("questions", [])
    except (ValueError, json.JSONDecodeError) as e:
        logger.warning(f"Batch JSON parse failed ({e}), retrying with fix prompt")
        fix_raw = ask_llm([
            SystemMessage(content="Return ONLY valid JSON. No preamble, no explanation, no markdown."),
            HumanMessage(content=f"Fix this malformed JSON and return it:\n{raw[:3000]}"),
        ])
        try:
            result = safe_json_extract(fix_raw)
            return result.get("questions", [])
        except Exception as e2:
            logger.warning(f"Fix prompt also failed: {e2}")
            return []


# ─────────────────────────────────────────────────────────────────────────────
# Async batch — uses ask_llm_async so we never block the event loop
# ─────────────────────────────────────────────────────────────────────────────

async def _generate_batch_async(
    count: int, question_type: str, context: str,
    system_msg: str, semaphore: asyncio.Semaphore
) -> list:
    """Ask the LLM for `count` questions asynchronously, respecting a concurrency semaphore."""
    async with semaphore:
        human_msg = get_quiz_human(count, question_type, context)
        raw = await ask_llm_async([SystemMessage(content=system_msg), HumanMessage(content=human_msg)])
        try:
            result = safe_json_extract(raw)
            return result.get("questions", [])
        except (ValueError, json.JSONDecodeError) as e:
            logger.warning(f"Async batch JSON parse failed ({e}), retrying")
            fix_raw = await ask_llm_async([
                SystemMessage(content="Return ONLY valid JSON. No preamble, no explanation, no markdown."),
                HumanMessage(content=f"Fix this malformed JSON and return it:\n{raw[:3000]}"),
            ])
            try:
                result = safe_json_extract(fix_raw)
                return result.get("questions", [])
            except Exception as e2:
                logger.warning(f"Async fix prompt also failed: {e2}")
                return []


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

    return fix_quiz_format({"questions": all_questions}, question_type, num_questions)


# ─────────────────────────────────────────────────────────────────────────────
# Format normalisation
# ─────────────────────────────────────────────────────────────────────────────

def fix_quiz_format(data: dict, question_type: str, target_count: int) -> dict:
    """Normalise question format and correct_answer for consistent frontend behaviour."""
    questions = data.get("questions", [])
    fixed = []

    for i, q in enumerate(questions):
        if not isinstance(q, dict) or "question" not in q:
            continue
        options = q.get("options", [])
        if not isinstance(options, list) or len(options) < 2:
            continue

        q_text = str(q.get("question", "")).strip()
        if not q_text:
            continue

        raw_answer = str(q.get("correct_answer", "A")).strip()
        difficulty = q.get("difficulty", "medium")
        if difficulty not in ("easy", "medium", "hard"):
            difficulty = "medium"

        fixed_q = {
            "id": len(fixed) + 1,
            "question": q_text,
            "explanation": str(q.get("explanation", "")).strip() or "See course material.",
            "difficulty": difficulty,
        }

        is_tf = (len(options) == 2 and
                 all(str(o).strip().lower() in ("true", "false") for o in options))

        if question_type == "True/False" or is_tf:
            fixed_q["options"] = ["True", "False"]
            fixed_q["correct_answer"] = _normalize_correct_answer(
                raw_answer, ["True", "False"], "True/False"
            )
        else:
            clean_opts = []
            for opt in options[:4]:
                stripped = re.sub(r'^[A-Da-d][.):\-\s]+', '', str(opt).strip())
                if stripped:
                    clean_opts.append(stripped)
            while len(clean_opts) < 4:
                clean_opts.append(f"Option {chr(65 + len(clean_opts))}")
            fixed_q["options"] = clean_opts[:4]
            fixed_q["correct_answer"] = _normalize_correct_answer(
                raw_answer, fixed_q["options"], "MCQ"
            )

        fixed.append(fixed_q)
        if len(fixed) >= target_count:
            break

    if not fixed:
        raise ValueError("No valid questions could be parsed from the model response")

    for i, q in enumerate(fixed):
        q["id"] = i + 1

    return {"questions": fixed}