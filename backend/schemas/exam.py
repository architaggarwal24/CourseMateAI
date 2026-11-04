"""Request / response shapes for exam mode (services/exam_service.py)."""
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from .base import ApiModel


class ExamCreateRequest(BaseModel):
    session_id: str
    length: Literal[10, 20, 30] = 20
    difficulty: Literal["easy", "medium", "hard", "mixed"] = "mixed"
    topics: List[str] = Field(default_factory=list, max_length=5)


class ExamAnswerRequest(BaseModel):
    index: int = Field(ge=0)
    answer: Optional[str] = None
    clear: bool = False                       # remove the answer (back to unanswered)
    flagged: Optional[bool] = None            # "come back to this one"


class ExamQuestion(ApiModel):
    index: int
    question: str
    options: List[str]
    answer: Optional[str] = None
    flagged: bool = False
    # after grading only:
    correct_answer: Optional[str] = None
    explanation: Optional[str] = None
    concept: Optional[str] = None
    difficulty: Optional[str] = None
    correct: Optional[bool] = None


class ExamResult(ApiModel):
    score: int
    total: int
    accuracy: float
    time_used_s: int
    submitted_at: str
    auto_submitted: bool
    concepts: List[Dict[str, Any]]            # {concept, correct, total, accuracy}, weakest first
    difficulties: List[Dict[str, Any]]        # {difficulty, correct, total, accuracy}
    unanswered: int
    weak_concepts: List[str]


class Exam(ApiModel):
    id: str
    status: str                               # active | graded
    session_id: str
    doc_name: str
    length: int
    difficulty: str
    topics: List[str]
    time_limit_s: int
    started_at: str
    deadline: str
    seconds_left: int
    answered: int
    total: int
    questions: List[ExamQuestion]
    result: Optional[ExamResult] = None
    rewards: Optional[Dict[str, Any]] = None


class ExamActiveResponse(ApiModel):
    exam: Optional[Exam] = None


class ExamAnswerResponse(ApiModel):
    ok: bool
    index: int
    answer: Optional[str] = None
    flagged: bool
    answered: int
    seconds_left: int


class ExamHistoryResponse(ApiModel):
    exams: List[Dict[str, Any]]


class ExamOptionsResponse(ApiModel):
    lengths: List[int]
    difficulties: List[str]
    seconds_per_question: Dict[str, int]
    suggested_topics: List[str]
    max_topics: int
