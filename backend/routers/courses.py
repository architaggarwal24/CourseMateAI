"""Courses: several of the user's PDFs studied together. A course id works wherever a document id does.
Rules: services/course_service.py."""
import asyncio

from fastapi import APIRouter, Depends, Request

from deps import require_auth
from schemas.base import OkResponse
from schemas.course import Course, CourseCreateRequest, CourseListResponse, CourseProgress, CourseUpdateRequest
from services import entitlements
from state import course_service, limiter

router = APIRouter()


def _gate(user) -> None:
    entitlements.require(user["user_id"], "courses")


@router.get("/courses", response_model=CourseListResponse, response_model_exclude_unset=True)
async def list_courses(user=Depends(require_auth)):
    _gate(user)
    return {"courses": await asyncio.to_thread(course_service.list, user["user_id"])}


@router.post("/courses", response_model=Course, response_model_exclude_unset=True)
@limiter.limit("30/minute")
async def create_course(req: CourseCreateRequest, request: Request, user=Depends(require_auth)):
    _gate(user)
    return await asyncio.to_thread(course_service.create, user["user_id"], name=req.name, description=req.description,
                                   document_ids=req.document_ids)


@router.get("/courses/{course_id}", response_model=Course, response_model_exclude_unset=True)
async def get_course(course_id: str, user=Depends(require_auth)):
    _gate(user)
    return await asyncio.to_thread(course_service.get, user["user_id"], course_id)


@router.put("/courses/{course_id}", response_model=Course, response_model_exclude_unset=True)
@limiter.limit("60/minute")
async def update_course(course_id: str, req: CourseUpdateRequest, request: Request, user=Depends(require_auth)):
    """Rename, describe, or set the course's documents (the full list, in order)."""
    _gate(user)
    return await asyncio.to_thread(course_service.update, user["user_id"], course_id, name=req.name,
                                   description=req.description, document_ids=req.document_ids)


@router.delete("/courses/{course_id}", response_model=OkResponse, response_model_exclude_unset=True)
@limiter.limit("30/minute")
async def delete_course(course_id: str, request: Request, user=Depends(require_auth)):
    """Delete the course. Its documents stay (they just stop being pinned by it)."""
    _gate(user)
    await asyncio.to_thread(course_service.delete, user["user_id"], course_id)
    return {"ok": True}


@router.get("/courses/{course_id}/progress", response_model=CourseProgress, response_model_exclude_unset=True)
async def course_progress(course_id: str, user=Depends(require_auth)):
    _gate(user)
    return await asyncio.to_thread(course_service.progress, user["user_id"], course_id)
