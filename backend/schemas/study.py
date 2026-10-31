from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    question: str
    session_id: str
    # FIX BUG 5: Pydantic v1 shares mutable defaults across instances.
    # Use Field(default_factory=list) to ensure each request gets its own list.
    history: list = Field(default_factory=list)
    top_k: int = 5            # how many chunks to retrieve (was a query parameter)


class QuizRequest(BaseModel):
    topic: str
    num_questions: int
    question_type: Literal["MCQ", "True/False", "Mixed"]
    session_id: str
    top_k: int = 5            # was a query parameter


class QuizAnswerRequest(BaseModel):
    quiz_id: str
    question_id: int
    answer: str


class QuizFinishRequest(BaseModel):
    quiz_id: str


class NotesRequest(BaseModel):
    topic: str
    detail_level: str
    session_id: str
    top_k: int = 5            # was a query parameter


class FlashcardRequest(BaseModel):
    topic: str
    session_id: str
    num_cards: int = 10       # was a query parameter


class FlashcardReviewRequest(BaseModel):
    """The user flipped a card and says whether they knew it: counts for that concept's mastery."""
    session_id: str
    concept: str
    correct: bool


# ── responses ─────────────────────────────────────────────────────────────────
from typing import Any, Dict, List, Optional  # noqa: E402

from .base import ApiModel  # noqa: E402


class HistoryResponse(ApiModel):
    history: List[Any]


class ChatResponse(ApiModel):
    mode: str
    content: str
    sources: List[Any]
    blocked: Optional[bool] = None
    needs_clarification: Optional[bool] = None
    rewards: Optional[Dict[str, Any]] = None


class FlashcardsResponse(ApiModel):
    cards: List[Any]
    total: int
    topic: str
    rewards: Optional[Dict[str, Any]] = None


class QuizResponse(ApiModel):
    mode: str
    quiz_id: str
    content: Any          # questions WITHOUT correct_answer / explanation
    sources: List[Any]


class QuizAnswerResponse(ApiModel):
    ok: bool
    question_id: int
    answer: str
    correct: bool
    correct_answer: str
    explanation: Optional[str] = None


class QuizFinishResponse(ApiModel):
    ok: bool
    quiz_id: str
    score: int
    total: int
    accuracy: float
    already_finished: bool
    rewards: Optional[Dict[str, Any]] = None


class NotesResponse(ApiModel):
    mode: str
    content: Any
    sources: List[Any]
    rewards: Optional[Dict[str, Any]] = None


class FlashcardReviewResponse(ApiModel):
    ok: bool
    concept: str
    mastery: Dict[str, Any]          # {concept, seen, correct, wrong_streak}


class ReviewDeckResponse(ApiModel):
    """Flashcards built from the questions the user missed (arena + quiz) on this document - no AI call."""
    ok: bool
    cards: List[Dict[str, Any]]      # {front, back, explanation, concept, topic, difficulty, source, missed_at}
    total: int
