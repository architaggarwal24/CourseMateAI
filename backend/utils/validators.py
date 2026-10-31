from typing import Optional


VALID_MODES = {"chat", "notes", "quiz", "arena"}

MAX_QUESTION_CHARS = 2000
MAX_TOPIC_CHARS = 200


def validate_question(question: Optional[str]) -> str:
    """
    Validates a user question.
    Returns cleaned question or raises ValueError.
    FIX BUG 31: Callers (main.py) must catch ValueError and re-raise as HTTPException.
    FastAPI does NOT auto-convert ValueError to 422 — it becomes a 500.
    """
    if question is None:
        raise ValueError("Question is required")

    question = question.strip()

    if not question:
        raise ValueError("Question cannot be empty")

    if len(question) < 3:
        raise ValueError("Question is too short")

    if len(question) > MAX_QUESTION_CHARS:
        raise ValueError(f"Question is too long (max {MAX_QUESTION_CHARS} characters)")

    return question


def validate_topic(topic: Optional[str]) -> str:
    """Topic/theme text used for retrieval and in prompts. Trimmed and length-capped."""
    topic = (topic or "").strip()
    if not topic:
        raise ValueError("Topic is required")
    if len(topic) > MAX_TOPIC_CHARS:
        raise ValueError(f"Topic is too long (max {MAX_TOPIC_CHARS} characters)")
    return topic



def validate_top_k(top_k: Optional[int], default: int = 5) -> int:
    """
    Validates retrieval depth.
    """
    if top_k is None:
        return default

    if not isinstance(top_k, int) or isinstance(top_k, bool):
        raise ValueError("top_k must be an integer")

    if top_k < 1 or top_k > 20:
        raise ValueError("top_k must be between 1 and 20")

    return top_k
