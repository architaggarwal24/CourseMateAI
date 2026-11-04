"""The spaced-repetition review queue (FSRS) and the plan entitlements. Rules: services/review_service.py."""
import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Request

from deps import require_auth
from schemas.review import (EntitlementsResponse, ReviewAddRequest, ReviewAddResponse, ReviewGradeRequest,
                            ReviewGradeResponse, ReviewQueueResponse, ReviewStats)
from schemas.base import OkResponse
from services import entitlements
from services.session_service import require_valid_session_id
from state import documents, limiter, quest_service, review_service, reward_service, store

router = APIRouter()


@router.get("/entitlements", response_model=EntitlementsResponse, response_model_exclude_unset=True)
async def get_entitlements(user=Depends(require_auth)):
    """The user's plan and, per feature, whether it is on and which plan has it."""
    return entitlements.summary(user["user_id"])


def _stats(user_id) -> dict:
    return {**review_service.stats(user_id), "locked": not entitlements.allowed(user_id, "review_queue")}


async def _doc_hash(session_id: str, user_id) -> str:
    require_valid_session_id(session_id)
    doc = await asyncio.to_thread(documents.get_document, session_id, user_id)          # ownership
    return doc["file_hash"]


async def _scope_hashes(session_id: str, user_id) -> list:
    """The cards a review of this document covers: a course's own cards and those of its documents."""
    require_valid_session_id(session_id)
    doc = await asyncio.to_thread(documents.get_document, session_id, user_id)          # ownership
    if doc.get("kind") != "course":
        return [doc["file_hash"]]
    members = await asyncio.to_thread(documents.repo.course_documents, session_id)
    return [doc["file_hash"], *(m["file_hash"] for m in members)]


@router.get("/review/stats", response_model=ReviewStats, response_model_exclude_unset=True)
async def review_stats(user=Depends(require_auth)):
    """How many cards are due (the nav badge). Answered on every plan: `locked` says whether reviewing is on."""
    return await asyncio.to_thread(_stats, user["user_id"])


@router.get("/review/queue", response_model=ReviewQueueResponse, response_model_exclude_unset=True)
@limiter.limit("120/minute")
async def review_queue(request: Request, limit: int = 20, session_id: Optional[str] = None, user=Depends(require_auth)):
    """The cards to review now, in order (learning, due reviews, then today's new cards). `session_id` narrows the
    queue to one document."""
    entitlements.require(user["user_id"], "review_queue")
    doc_hash = await _scope_hashes(session_id, user["user_id"]) if session_id else None
    items = await asyncio.to_thread(review_service.queue, user["user_id"], limit=limit, doc_hash=doc_hash)
    return {"ok": True, "items": items, "stats": await asyncio.to_thread(_stats, user["user_id"])}


def _after_grade(user_id) -> tuple:
    """Streak, quests, and - once a day, when the queue is cleared - the review_complete reward."""
    uid = str(user_id)
    store.ensure_user(uid)
    quest_service.get_or_create_daily_quests(uid)
    reward_service.streaks.update_streak_for_activity(uid)
    quest_service.mark_maintained_streak(uid)
    quest_service.on_action(uid, "review_card")
    stats = _stats(user_id)
    rewards = None
    if stats["due"] == 0 and stats["reviewed_today"] > 0:
        rewards = reward_service.award(uid, "review_complete", source_id=f"review:{store.user_today(uid).isoformat()}")
        if rewards and rewards.get("ok"):
            quest_service.on_action(uid, "review_complete")
        else:
            rewards = None
    return stats, rewards


@router.post("/review/grade", response_model=ReviewGradeResponse, response_model_exclude_unset=True)
@limiter.limit("240/minute")
async def review_grade(req: ReviewGradeRequest, request: Request, user=Depends(require_auth)):
    """Grade one card: 1 Again, 2 Hard, 3 Good, 4 Easy. FSRS sets when it comes back."""
    entitlements.require(user["user_id"], "review_queue")
    result = await asyncio.to_thread(review_service.grade, user["user_id"], req.item_id, req.rating,
                                     reps=req.reps, duration_ms=req.duration_ms)
    stats, rewards = await asyncio.to_thread(_after_grade, user["user_id"])
    return {"ok": True, "item": result["item"], "mastery": result["mastery"], "stats": stats, "rewards": rewards}


@router.post("/review/cards", response_model=ReviewAddResponse, response_model_exclude_unset=True)
@limiter.limit("30/minute")
async def review_add(req: ReviewAddRequest, request: Request, user=Depends(require_auth)):
    """Add flashcards to the queue ("Add deck to review"). A card already there is left as it is."""
    entitlements.require(user["user_id"], "review_queue")
    doc_hash = await _doc_hash(req.session_id, user["user_id"])
    out = await asyncio.to_thread(review_service.add_cards, user["user_id"], doc_hash,
                                  [c.model_dump() for c in req.cards])
    return {"ok": True, **out, "stats": await asyncio.to_thread(_stats, user["user_id"])}


@router.delete("/review/cards/{item_id}", response_model=OkResponse, response_model_exclude_unset=True)
@limiter.limit("120/minute")
async def review_remove(item_id: int, request: Request, user=Depends(require_auth)):
    """Take a card out of the queue for good."""
    entitlements.require(user["user_id"], "review_queue")
    await asyncio.to_thread(review_service.remove, user["user_id"], item_id)
    return {"ok": True}
