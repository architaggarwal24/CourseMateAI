"""Exam mode: a timed mock test from a document, graded on the server, with a PDF score report.
Rules: services/exam_service.py."""
import asyncio

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from core_brains.exam_brain import generate_exam_async
from deps import inject_user_llm_key, raise_quota_if_needed, require_auth
from errors import AppError, generation_failed, invalid_input
from schemas.exam import (Exam, ExamActiveResponse, ExamAnswerRequest, ExamAnswerResponse, ExamCreateRequest,
                          ExamHistoryResponse, ExamOptionsResponse)
from services import entitlements
from services.exam_report import render_exam_report
from services.exam_service import DIFFICULTIES, LENGTHS, MAX_TOPICS, SECONDS_PER_QUESTION
from services.session_service import require_valid_session_id
from state import documents, exam_service, limiter, store
from utils.validators import validate_topic

router = APIRouter()


def _gate(user) -> None:
    entitlements.require(user["user_id"], "exam_mode")


@router.get("/exams/options", response_model=ExamOptionsResponse, response_model_exclude_unset=True)
async def exam_options(session_id: str, user=Depends(require_auth)):
    """What an exam can be: lengths, difficulties, the clock per question, and topics to suggest (the concepts
    this document's questions have covered so far, weakest first)."""
    _gate(user)
    require_valid_session_id(session_id)
    doc = await asyncio.to_thread(documents.get_document, session_id, user["user_id"])
    rows = await asyncio.to_thread(
        store.fetchall,
        "SELECT concept FROM concept_mastery WHERE user_id = ? AND doc_hash = ? "
        "ORDER BY (seen - correct) DESC, seen DESC, concept LIMIT 12", (int(user["user_id"]), doc["file_hash"]))
    return {"lengths": list(LENGTHS), "difficulties": list(DIFFICULTIES), "seconds_per_question": SECONDS_PER_QUESTION,
            "suggested_topics": [r["concept"] for r in rows], "max_topics": MAX_TOPICS}


@router.post("/exams", response_model=Exam, response_model_exclude_unset=True)
@limiter.limit("6/minute")
async def create_exam(req: ExamCreateRequest, request: Request, user=Depends(inject_user_llm_key)):
    """Write a new exam from the document and start its clock."""
    _gate(user)
    require_valid_session_id(req.session_id)
    topics = []
    for t in req.topics:
        try:
            t = validate_topic(t)
        except ValueError as e:
            raise invalid_input(str(e), field="topics")
        if t and t.lower() not in {x.lower() for x in topics}:
            topics.append(t)
    running = await asyncio.to_thread(exam_service.active, user["user_id"])
    if running:                                                         # before paying for an LLM call
        raise AppError("exam_in_progress", "Finish (or submit) the exam you started first.", status_code=409,
                       details={"exam_id": running["id"]})
    doc = await asyncio.to_thread(documents.get_document, req.session_id, user["user_id"])
    vector_store = await documents.get_index(req.session_id, user["user_id"])
    try:
        questions = await generate_exam_async(vector_store, length=req.length, difficulty=req.difficulty, topics=topics)
    except Exception as e:
        raise_quota_if_needed(e)
        raise generation_failed("The exam couldn't be written. Please try again.")
    return await asyncio.to_thread(
        exam_service.create, user["user_id"], session_id=req.session_id, doc_hash=doc["file_hash"],
        doc_name=doc["filename"], length=req.length, difficulty=req.difficulty, topics=topics, questions=questions)


@router.get("/exams/active", response_model=ExamActiveResponse, response_model_exclude_unset=True)
async def active_exam(user=Depends(require_auth)):
    """The exam in progress (to resume after a refresh), or null."""
    _gate(user)
    return {"exam": await asyncio.to_thread(exam_service.active, user["user_id"])}


@router.get("/exams", response_model=ExamHistoryResponse, response_model_exclude_unset=True)
async def exam_history(limit: int = 20, user=Depends(require_auth)):
    _gate(user)
    return {"exams": await asyncio.to_thread(exam_service.history, user["user_id"], limit)}


@router.get("/exams/{exam_id}", response_model=Exam, response_model_exclude_unset=True)
async def get_exam(exam_id: str, user=Depends(require_auth)):
    _gate(user)
    return await asyncio.to_thread(exam_service.get, user["user_id"], exam_id)


@router.post("/exams/{exam_id}/answers", response_model=ExamAnswerResponse, response_model_exclude_unset=True)
@limiter.limit("240/minute")
async def answer_exam(exam_id: str, req: ExamAnswerRequest, request: Request, user=Depends(require_auth)):
    """Save, change or clear an answer, or flag a question. No feedback until the exam is graded."""
    _gate(user)
    return await asyncio.to_thread(exam_service.answer, user["user_id"], exam_id, req.index, answer=req.answer,
                                   clear=req.clear, flagged=req.flagged)


@router.post("/exams/{exam_id}/submit", response_model=Exam, response_model_exclude_unset=True)
@limiter.limit("30/minute")
async def submit_exam(exam_id: str, request: Request, user=Depends(require_auth)):
    """Grade the exam (once). Answering again returns the same result."""
    _gate(user)
    return await asyncio.to_thread(exam_service.submit, user["user_id"], exam_id)


@router.get("/exams/{exam_id}/report.pdf", response_class=Response,
            responses={200: {"content": {"application/pdf": {}}, "description": "The PDF score report"}})
@limiter.limit("20/minute")
async def exam_report(exam_id: str, request: Request, user=Depends(require_auth)):
    _gate(user)
    exam = await asyncio.to_thread(exam_service.get, user["user_id"], exam_id)
    if exam["status"] != "graded":
        raise AppError("exam_not_graded", "The report is ready once the exam is submitted.", status_code=409)
    pdf = await asyncio.to_thread(render_exam_report, exam, user.get("full_name") or user.get("username") or "")
    name = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in exam["doc_name"].rsplit(".", 1)[0])[:40] or "exam"
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="exam-report-{name}.pdf"'})
