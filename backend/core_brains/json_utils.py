"""
Shared JSON extraction and answer normalisation utilities for quiz_brain and boss_brain.
Extracted to eliminate duplication (was copy-pasted between the two modules).
"""
import re
import json
import logging

logger = logging.getLogger(__name__)


def safe_json_extract(text: str) -> dict:
    """
    Extract the first valid JSON object from a string, with fallback truncation recovery.
    Handles markdown code fences, leading/trailing whitespace, and truncated JSON.
    """
    if not text:
        return {}

    # Strip markdown fences
    text = re.sub(r"```(?:json)?\s*", "", text).strip()
    text = re.sub(r"```\s*$", "", text).strip()

    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Find the first { ... } block
    start = text.find("{")
    if start == -1:
        return {}

    # Try progressively shorter substrings (truncation recovery)
    snippet = text[start:]
    for end in range(len(snippet), 0, -1):
        try:
            return json.loads(snippet[:end])
        except json.JSONDecodeError:
            continue

    logger.warning("safe_json_extract: could not parse any JSON from response")
    return {}


def normalize_answer(answer: str, options: list, question_type: str = "MCQ") -> str:
    """
    Normalise LLM answer strings to a consistent letter (A/B/C/D) or True/False.
    Handles:
      - Letter-only: "A"
      - Prefixed:    "A. Some text"
      - Content-only: full option text (Gemini style)
      - True/False questions
    """
    if not answer or not options:
        return answer or ""

    answer = answer.strip()

    # True/False normalisation
    if question_type in ("True/False", "TrueFalse") or (
        len(options) == 2 and all(o.strip().lower() in ("true", "false") for o in options)
    ):
        lower = answer.lower()
        if "true" in lower:
            return "True"
        if "false" in lower:
            return "False"

    # Letter-only or letter-prefixed
    letter_match = re.match(r"^([A-Da-d])[.)\s]", answer)
    if letter_match:
        return letter_match.group(1).upper()
    if len(answer) == 1 and answer.upper() in "ABCD":
        return answer.upper()

    # Map option index letters
    letter_map = {chr(65 + i): opt for i, opt in enumerate(options)}

    # Full content match
    answer_lower = answer.lower().strip()
    for letter, opt in letter_map.items():
        if opt.strip().lower() == answer_lower:
            return letter

    # Partial match fallback
    for letter, opt in letter_map.items():
        if answer_lower in opt.strip().lower() or opt.strip().lower() in answer_lower:
            return letter

    logger.warning(f"normalize_answer: could not map {answer!r} to any of {options}")
    return answer


def retry_json_fix(raw: str, fix_fn) -> dict:
    """
    Call fix_fn(raw) to get a corrected JSON string, then parse it.
    fix_fn should be a callable that sends the raw string to the LLM for repair.
    Returns empty dict if fix_fn raises or result is not parseable.
    """
    try:
        fixed_raw = fix_fn(raw)
        return safe_json_extract(fixed_raw)
    except Exception as e:
        logger.warning(f"retry_json_fix: fix attempt failed: {e}")
        return {}


def _normalize_correct_answer(answer: str, options: list, question_type: str = "MCQ") -> str:
    """
    Normalise correct_answer to match an actual option string.

    Different LLM providers return different formats:
      Mistral:  "A"              — letter only  (sometimes "A. text")
      OpenAI:   "A"              — letter only
      Claude:   "A"              — letter only
      Gemini:   "First option"   — content only, no letter prefix

    For True/False, all providers return "True" or "False" fairly consistently,
    but we normalise capitalisation just in case.
    """
    if not answer or not options:
        return options[0] if options else answer

    answer = answer.strip()

    # ── True/False ────────────────────────────────────────────────────────────
    if question_type == "True/False" or options == ["True", "False"]:
        low = answer.lower()
        if "true" in low or low in ("a", "1", "t", "yes"):
            return "True"
        return "False"

    # ── MCQ ───────────────────────────────────────────────────────────────────

    # 1. Direct match
    if answer in options:
        return answer

    # 2. Single letter: "A", "B", "C", "D"
    if len(answer) == 1 and answer.upper() in "ABCD":
        idx = ord(answer.upper()) - ord('A')
        if 0 <= idx < len(options):
            return options[idx]

    # 3. "A. text", "B) text", "A - text"
    m = re.match(r'^([A-Da-d])[.):\-\s]+(.*)$', answer)
    if m:
        idx = ord(m.group(1).upper()) - ord('A')
        if 0 <= idx < len(options):
            return options[idx]

    # 4. Content match: strip prefixes from options, compare to answer
    answer_lower = answer.lower().strip()
    for opt in options:
        opt_content = re.sub(r'^[A-Da-d][.):\-\s]+', '', opt).strip().lower()
        if opt_content == answer_lower or answer_lower in opt_content or opt_content in answer_lower:
            return opt

    # 5. Fallback — return first option rather than a broken string.
    # FIX BUG 15: Log as an error (not just warning) so monitoring systems catch
    # consistent normalization failures. Returning options[0] means the first answer
    # is always "correct" when the LLM returns an unrecognizable format — silent
    # wrong answers are worse than a visible error, so we surface it clearly.
    logger.error(
        f"_normalize_correct_answer FAILED: could not map {answer!r} to any of {options}. "
        f"Defaulting to options[0]={options[0]!r}. Check LLM prompt or provider output.",
    )
    return options[0]


# ─────────────────────────────────────────────────────────────────────────────
# JSON extraction — handles truncated responses from flash models
# ─────────────────────────────────────────────────────────────────────────────

def _extract_complete_question_objects(text: str) -> list:
    """
    Pull out complete question JSON objects from potentially truncated text.
    Uses bracket counting so we only return objects that are fully closed.
    """
    questions = []
    i = 0
    while i < len(text):
        # Find the start of a potential question object
        start = text.find('{', i)
        if start == -1:
            break
        # Count braces to find the matching closing brace
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
            break  # Truncated — no closing brace found
        obj_str = text[start:end + 1]
        # Fix trailing commas before attempting parse
        obj_str = re.sub(r',\s*([}\]])', r'\1', obj_str)
        try:
            obj = json.loads(obj_str)
            # Only keep objects that look like questions
            if isinstance(obj, dict) and 'question' in obj and 'options' in obj:
                questions.append(obj)
        except json.JSONDecodeError:
            pass
        i = end + 1
    return questions