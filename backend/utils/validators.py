from typing import Optional


VALID_MODES = {"chat", "notes", "quiz", "arena"}


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

    return question



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
