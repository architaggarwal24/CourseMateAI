"""Request / response shapes for courses (services/course_service.py)."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .base import ApiModel


class CourseCreateRequest(BaseModel):
    name: str = Field(max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    document_ids: List[str] = Field(default_factory=list, max_length=20)


class CourseUpdateRequest(BaseModel):
    """Only the fields sent change. `document_ids` is the full list, in order (add, remove, reorder)."""
    name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    document_ids: Optional[List[str]] = Field(None, max_length=20)


class CourseDocument(ApiModel):
    id: str
    filename: str
    status: str
    chunks: Optional[int] = None
    pdf_available: bool


class Course(ApiModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: str
    updated_at: str
    documents: List[CourseDocument]
    ready: int


class CourseListResponse(ApiModel):
    courses: List[Course]


class CourseProgress(ApiModel):
    course_id: str
    mastery: float                                  # share of the concepts seen that are mastered
    concepts: Dict[str, Any]                        # {seen, strong, weak, weakest: [...]}
    answers: Dict[str, Any]                         # {total, correct, accuracy}
    review: Dict[str, int]                          # {cards, due}
    exams: List[Dict[str, Any]]
    documents: List[Dict[str, Any]]                 # per document: {id, filename, concepts, answered, accuracy}
