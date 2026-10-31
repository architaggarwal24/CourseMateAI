"""Tolerant JSON extraction (the fallback when a provider has no native structured output) and the
answer-label helpers shared by the quiz and arena schemas (core_brains/llm_schemas.py)."""
import json
import logging
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

_FENCE = re.compile(r"```[ \t]*(?:json|JSON)?[ \t]*\r?\n?(.*?)```", re.DOTALL)
_TRAILING_COMMA = re.compile(r",\s*([}\]])")
_DECODER = json.JSONDecoder()


def _loads(text: str) -> Any:
    """json.loads, retried once with trailing commas removed. Raises ValueError."""
    try:
        return json.loads(text)
    except ValueError:
        return json.loads(_TRAILING_COMMA.sub(r"\1", text))


def _close_open_structures(text: str) -> Optional[str]:
    """Repair a response cut off mid-way: drop the unfinished tail and close what is still open.
    Returns None when nothing usable is left."""
    stack, in_string, escaped, last_safe = [], False, False, None
    for i, ch in enumerate(text):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if not stack:
                return None
            stack.pop()
            if stack:
                last_safe = (i + 1, "".join(reversed(stack)))     # a complete nested value just ended
        elif ch == "," and stack:
            last_safe = (i, "".join(reversed(stack)))             # between two members
    if not stack:
        return text
    if last_safe is None:
        return None
    cut, closers = last_safe
    return text[:cut] + closers


def extract_json(text: str) -> Any:
    """The first JSON object/array in an LLM answer, or None.

    Handles: a bare document, ```json fences, prose before/after, trailing commas, and a response
    that was cut off (the complete items before the cut are kept)."""
    if not text or not text.strip():
        return None
    text = text.strip()
    candidates = [text] + [m.group(1).strip() for m in _FENCE.finditer(text)]
    for cand in candidates:
        try:
            return _loads(cand)
        except ValueError:
            pass
    for cand in candidates:
        for m in re.finditer(r"[{\[]", cand):
            snippet = _TRAILING_COMMA.sub(r"\1", cand[m.start():])
            try:
                value, _ = _DECODER.raw_decode(snippet)
                return value
            except ValueError:
                pass
            repaired = _close_open_structures(snippet)
            if repaired:
                try:
                    return json.loads(repaired)
                except ValueError:
                    pass
    logger.warning("extract_json: no JSON found in the response")
    return None


# An option label like "A. ", "B) ", "(C) ", "D: " or "A - " – requires the
# separator AND following whitespace so "B-cell", "a mitochondrion" and
# "A deterministic algorithm" are NOT treated as labels.
_LABEL_RE = re.compile(r"^\s*\(?([A-Da-d])(?:[.):]\s+|\s+[-–—]\s+)")


def strip_option_prefixes(options: list) -> list:
    """Remove "A. "/"B) " style labels – but only when the options are *consistently*
    labelled A, B, C, D… in order.

    The previous regex (``^[A-Da-d][.):\\-\\s]+``) stripped any leading a/b/c/d
    followed by a space, so "A deterministic algorithm…" became "deterministic
    algorithm…", "a mitochondrion" became "mitochondrion" and "B-cell receptors"
    became "cell receptors". Requiring a full, in-order label set avoids that.
    """
    opts = [str(o) for o in options]
    letters = []
    for o in opts:
        m = _LABEL_RE.match(o)
        if not m:
            return [o.strip() for o in opts]
        letters.append(m.group(1).upper())
    expected = [chr(65 + i) for i in range(len(opts))]
    if letters != expected:
        return [o.strip() for o in opts]
    return [_LABEL_RE.sub("", o, count=1).strip() for o in opts]


def _normalize_correct_answer(answer: str, options: list, question_type: str = "MCQ"):
    """
    Normalise correct_answer to match an actual option string.

    Different LLM providers return different formats:
      Llama/Qwen (NIM, Ollama): "A" or "A. text"
      OpenAI:   "A"              — letter only
      Claude:   "A"              — letter only
      Gemini:   "First option"   — content only, no letter prefix

    Returns the matching entry from ``options`` (unchanged), or **None** when the
    answer cannot be mapped. The old behaviour – silently returning options[0] –
    meant an unparseable answer was graded as "the first option is correct",
    which produced wrong answer keys. Callers must drop the question on None.
    """
    if not answer or not options:
        return None

    answer = str(answer).strip()

    # ── True/False ────────────────────────────────────────────────────────────
    if question_type == "True/False" or list(options) == ["True", "False"]:
        low = answer.lower().strip(" .!")
        if low in ("true", "t", "yes", "a", "1") or low.startswith("true"):
            return "True"
        if low in ("false", "f", "no", "b", "2") or low.startswith("false"):
            return "False"
        return None

    # ── MCQ ───────────────────────────────────────────────────────────────────

    # 1. Direct match
    if answer in options:
        return answer

    # 2. Single letter: "A", "B", "C", "D"
    if len(answer) == 1 and answer.upper() in "ABCD":
        idx = ord(answer.upper()) - ord('A')
        if 0 <= idx < len(options):
            return options[idx]

    # 3. "A. text", "B) text", "A - text": trust the letter
    m = _LABEL_RE.match(answer)
    if m:
        idx = ord(m.group(1).upper()) - ord('A')
        if 0 <= idx < len(options):
            return options[idx]

    # 4. Content match against option text with labels removed.
    #    Compare exact first, then containment – and never with an empty string,
    #    because ''.in(anything) is True and matched every option.
    stripped = strip_option_prefixes(options)
    answer_body = strip_option_prefixes([answer])[0].lower().strip()
    if answer_body:
        for opt, body in zip(options, stripped):
            if body.lower().strip() == answer_body:
                return opt
        hits = [opt for opt, body in zip(options, stripped)
                if body.strip() and (answer_body in body.lower() or body.lower() in answer_body)]
        if len(hits) == 1:          # ambiguous containment is not good enough
            return hits[0]

    logger.error(
        f"_normalize_correct_answer: could not map {answer!r} to any of {options}. "
        f"Dropping the question. Check the LLM prompt or provider output."
    )
    return None
