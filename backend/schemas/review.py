"""Request / response shapes for the spaced-repetition review queue and the plan entitlements."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .base import ApiModel


# ── requests ──────────────────────────────────────────────────────────────────
class ReviewGradeRequest(BaseModel):
    item_id: int
    rating: int = Field(ge=1, le=4, description="1 Again, 2 Hard, 3 Good, 4 Easy")
    reps: Optional[int] = Field(None, ge=0, description="The card's reps as shown: a second grade of the same view is refused")
    duration_ms: Optional[int] = Field(None, ge=0)


class ReviewCardIn(BaseModel):
    front: str
    back: str
    explanation: Optional[str] = None
    concept: Optional[str] = None


class ReviewAddRequest(BaseModel):
    session_id: str
    cards: List[ReviewCardIn] = Field(min_length=1, max_length=100)


# ── responses ─────────────────────────────────────────────────────────────────
class ReviewDocument(ApiModel):
    session_id: Optional[str] = None
    name: Optional[str] = None


class ReviewItem(ApiModel):
    id: int
    front: str
    back: str
    explanation: Optional[str] = None
    concept: Optional[str] = None
    source: str                                   # flashcard | arena | quiz | exam
    state: str                                    # new | learning | review | relearning
    due: str
    reps: int
    lapses: int
    document: ReviewDocument
    intervals: Optional[Dict[str, int]] = None    # rating "1".."4" -> seconds until it would be due again


class ReviewStats(ApiModel):
    due: int
    learning: int
    review: int
    new: int
    new_waiting: int
    new_left_today: int
    reviewed_today: int
    total: int
    by_source: Dict[str, int]
    next_due_at: Optional[str] = None
    locked: bool = False


class ReviewQueueResponse(ApiModel):
    ok: bool
    items: List[ReviewItem]
    stats: ReviewStats


class ReviewGradeResponse(ApiModel):
    ok: bool
    item: ReviewItem
    stats: ReviewStats
    mastery: Optional[Dict[str, Any]] = None
    rewards: Optional[Dict[str, Any]] = None      # review_complete, once a day, when the queue is cleared


class ReviewAddResponse(ApiModel):
    ok: bool
    added: int
    existing: int
    skipped: int
    stats: ReviewStats


class FeatureEntitlement(ApiModel):
    enabled: bool
    name: str
    required_tier: str
    required_tier_name: str


class EntitlementsResponse(ApiModel):
    tier: str
    tier_name: str
    features: Dict[str, FeatureEntitlement]
