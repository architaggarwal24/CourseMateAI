"""History plus the study tools: chat (plain and streamed), flashcards, quiz and notes.

Nothing in here blocks the event loop: embedding / FAISS search, SQLite bookkeeping and the (sync) LLM helpers
run in worker threads, and the streaming and rewrite calls are natively async."""
import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from config import settings
from core_brains.chat_brain import chat_with_context, stream_chat_with_context
from core_brains.flashcard_brain import generate_flashcards
from core_brains.llm_connection import ask_llm_quick_async, request_model_id, snapshot_request_llm
from core_brains.notes_brain import generate_notes
from core_brains.query_rewriter import Rewrite, standalone_question
from core_brains.quiz_brain import generate_quiz_async
from errors import AppError, generation_failed, invalid_input
from deps import inject_user_llm_key, provider_error_for, raise_quota_if_needed, require_auth
from schemas import ChatRequest, FlashcardRequest, NotesRequest, QuizAnswerRequest, QuizFinishRequest, QuizRequest
from schemas.study import (ChatResponse, FlashcardReviewRequest, FlashcardReviewResponse, FlashcardsResponse,
                           HistoryResponse, NotesResponse, QuizAnswerResponse, QuizFinishResponse, QuizResponse,
                           ReviewDeckResponse)
from services.chat_stream import SSE_HEADERS, chat_event_stream, sse
from services.generation_cache import cache_key
from services.context_service import Retrieval, assess_relevance, describe, ensure_topic_covered, retrieve
from services.session_service import require_valid_session_id
from state import (documents, generation_cache, history_service, limiter, mastery_service, quest_service, quiz_service,
                   reward_service, store)
from utils.validators import validate_question, validate_top_k, validate_topic

logger = logging.getLogger(__name__)
router = APIRouter()

AI_FAILED = "The AI request failed. Please try again."


def _ai_request_failed() -> AppError:
    return AppError("ai_request_failed", AI_FAILED, status_code=500, action="retry")


@router.get("/history", response_model=HistoryResponse, response_model_exclude_unset=True)
async def get_history(mode: str = None, limit: int = 100, user=Depends(require_auth)):
    history = await asyncio.to_thread(history_service.get_user_history, user_id=user['user_id'], mode=mode, limit=limit)
    return {"history": history}


@router.get("/history/session/{session_id}", response_model=HistoryResponse, response_model_exclude_unset=True)
async def get_session_history(session_id: str, user=Depends(require_auth)):
    await asyncio.to_thread(documents.check_owner, session_id, user["user_id"])
    # Also filtered by user_id in SQL, so it stays safe after the session expires from memory.
    history = await asyncio.to_thread(history_service.get_session_history, session_id, user["user_id"])
    return {"history": history}


def _sanitize_history(raw, max_turns: int = 20, max_chars: int = 4000) -> list:
    """`history` arrives as an untyped list from the browser. Keep only well-formed
    user/assistant turns (a non-dict item used to raise AttributeError → 500), and cap
    their size so a client can't inflate the prompt (cost) arbitrarily."""
    clean = []
    for turn in (raw or [])[-max_turns:]:
        if not isinstance(turn, dict):
            continue
        role = turn.get("role")
        content = turn.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        clean.append({"role": role, "content": content[:max_chars]})
    return clean


@dataclass
class _ChatPlan:
    """Everything decided before the model is called, shared by /chat and /chat/stream."""
    question: str
    history: list
    found: Retrieval
    quality: dict
    rewrite: Rewrite

    @property
    def blocked(self) -> bool:
        return self.quality["blocked"]

    @property
    def needs_clarification(self) -> bool:
        return self.quality["needs_clarification"]

    @property
    def llm_context(self) -> str:
        if self.needs_clarification:
            return (f"The following content was found:\n\n{self.found.context}\n\n"
                    "If relevant, explain it. Otherwise, ask the user to clarify.")
        return self.found.context


async def _plan_chat(req: ChatRequest, user: dict) -> _ChatPlan:
    # FIX BUG 4: Wrap validator calls — they raise ValueError which FastAPI
    # does NOT auto-convert to 422; it becomes a 500. Catch and re-raise as HTTP 400.
    try:
        question = validate_question(req.question)
    except ValueError as e:
        raise invalid_input(str(e))
    try:
        top_k = validate_top_k(req.top_k)
    except ValueError as e:
        raise invalid_input(str(e))
    history = _sanitize_history(req.history)

    vector_store = await documents.get_index(req.session_id, user['user_id'])

    # Logged before anything else happens (in a worker thread), so history reads question -> answer in order
    # and the question is kept even if the answer later fails.
    await asyncio.to_thread(
        history_service.log_activity,
        user_id=user['user_id'], session_id=req.session_id,
        mode='chat', action_type='query', content={'question': question}
    )

    # A follow-up ("why does it happen?") is rewritten into a standalone question from the last few turns
    # before searching. No history / already self-contained -> no LLM call; a failed call -> fallback query.
    rewrite = await standalone_question(
        question, history, ask_llm_quick_async,
        enabled=settings.query_rewrite, max_messages=settings.query_rewrite_turns)

    # Embedding the query is CPU-bound (bge-large): a worker thread, never the event loop.
    found = await asyncio.to_thread(retrieve, vector_store, rewrite.query, top_k)
    quality = assess_relevance(found)
    logger.info("chat %s relevance=%s query=%s", describe(found), quality["reason"], rewrite.method)
    return _ChatPlan(question, history, found, quality, rewrite)


def _record_chat_answer(user: dict, session_id: str, plan: _ChatPlan, answer: str) -> Optional[dict]:
    """History + quest/XP bookkeeping for an answered chat question (blocking SQLite: call via to_thread).
    Returns the reward payload, if the answer earned one."""
    user_id = str(user['user_id'])
    question = plan.question
    q = question.strip()
    # A question counts toward the quest if it has at least 3 chars and isn't
    # pure whitespace/punctuation. The old threshold (10 chars, 5 unique chars)
    # was too strict — short follow-up questions like "Why?" or "How?" are real
    # questions but were silently ignored, causing the "ask 10 questions" quest
    # to only register the first long question and skip all follow-ups.
    is_quality = (len(q) >= 3 and any(c.isalpha() for c in q))

    if plan.needs_clarification:
        history_service.log_activity(
            user_id=user['user_id'], session_id=session_id,
            mode='chat', action_type='response', content={'answer': answer, 'needs_clarification': True}
        )
        # Track quest progress even for clarification responses — this is still
        # a real question asked. Without this, follow-up questions in the same
        # chat never register toward the "Ask 10 questions" quest.
        if is_quality:
            store.ensure_user(user_id)
            quest_service.get_or_create_daily_quests(user_id)
            quest_service.on_chat_question(user_id)
            quest_service.mark_maintained_streak(user_id)
        return None

    history_service.log_activity(
        user_id=user['user_id'], session_id=session_id,
        mode='chat', action_type='response', content={'answer': answer, 'sources': len(plan.found.sources)}
    )
    reward_payload = None
    if is_quality:
        store.ensure_user(user_id)
        store.increment_progress(user_id, "total_chat_questions", 1)
        quest_service.get_or_create_daily_quests(user_id)
        quest_service.on_chat_question(user_id)  # tracks ask_questions quest
        quest_service.mark_maintained_streak(user_id)  # tracks maintain_streak quest

        # Read updated count directly from DB (increment_progress is atomic)
        row = store.fetchone(
            "SELECT total_chat_questions FROM user_progress WHERE user_id = ?",
            (user_id,)
        )
        total_chat_questions = int((row or {}).get("total_chat_questions", 0) or 0)
        if total_chat_questions % 5 == 0:
            reward_payload = reward_service.award(
                user_id=user_id, action_type="chat_bundle_5",
                accuracy=1.0, difficulty=1.0, combo_count=1
            )
    return reward_payload


def _blocked_text(question: str) -> str:
    return f'I cannot find "{question}" in the uploaded PDF.'


@router.post("/chat", response_model=ChatResponse, response_model_exclude_unset=True)
@limiter.limit("30/minute")
async def chat(req: ChatRequest, request: Request, user=Depends(inject_user_llm_key)):
    plan = await _plan_chat(req, user)

    if plan.blocked:
        return {"mode": "chat", "content": _blocked_text(plan.question), "sources": [], "blocked": True}

    try:
        # to_thread copies the current contextvars, so the per-request API key set by
        # inject_user_llm_key is still visible inside the worker thread.
        answer = await asyncio.to_thread(chat_with_context, plan.question, plan.llm_context, plan.history)
    except Exception as _llm_e:
        raise_quota_if_needed(_llm_e)
        # Don't echo raw provider/internal error text (can contain paths or key fragments).
        logger.exception("chat failed")
        raise _ai_request_failed()

    reward_payload = await asyncio.to_thread(_record_chat_answer, user, req.session_id, plan, answer)

    if plan.needs_clarification:
        return {"mode": "chat", "content": answer, "sources": plan.found.sources, "needs_clarification": True}
    return {"mode": "chat", "content": answer, "sources": plan.found.sources, "rewards": reward_payload}


def _stream_error(exc: Exception) -> AppError:
    """A mid-answer failure as the API's unified error (never the raw provider text)."""
    return provider_error_for(exc) or _ai_request_failed()


@router.post(
    "/chat/stream",
    response_class=StreamingResponse,
    responses={200: {
        "description": (
            "Server-Sent Events. `token` events ({\"text\"}) carry the answer as it is written; the final `sources` "
            "event carries {mode, sources, blocked, needs_clarification, rewards}; a failure after the first token "
            "arrives as an `error` event in the unified error shape. Failures before the first token are ordinary "
            "HTTP errors with the same body."),
        "content": {"text/event-stream": {"schema": {"type": "string"}}},
    }},
)
@limiter.limit("30/minute")
async def chat_stream(req: ChatRequest, request: Request, user=Depends(inject_user_llm_key)):
    plan = await _plan_chat(req, user)

    def final_payload(rewards: Optional[dict], blocked: bool = False) -> dict:
        return {"mode": "chat", "sources": [] if blocked else plan.found.sources, "blocked": blocked,
                "needs_clarification": plan.needs_clarification, "rewards": rewards}

    if plan.blocked:
        async def blocked_frames():
            yield sse("token", {"text": _blocked_text(plan.question)})
            yield sse("sources", final_payload(None, blocked=True))
        return StreamingResponse(blocked_frames(), media_type="text/event-stream", headers=SSE_HEADERS)

    # The response outlives this request's dependencies, so capture the user's LLM settings now.
    try:
        llm = snapshot_request_llm()
    except Exception:
        logger.exception("chat stream: no usable LLM settings")
        raise _ai_request_failed()

    tokens = stream_chat_with_context(plan.question, plan.llm_context, plan.history, llm)
    try:
        first = await anext(tokens)
    except StopAsyncIteration:
        raise _ai_request_failed()
    except Exception as exc:                  # nothing has been sent yet: answer with a normal HTTP error
        await tokens.aclose()
        raise_quota_if_needed(exc)
        logger.exception("chat stream failed before the first token")
        raise _ai_request_failed()

    async def finish(answer: str) -> dict:
        try:
            rewards = await asyncio.to_thread(_record_chat_answer, user, req.session_id, plan, answer)
        except Exception:                     # the answer has already been delivered: don't turn it into an error
            logger.exception("chat stream: recording the answer failed")
            rewards = None
        return final_payload(rewards)

    return StreamingResponse(
        chat_event_stream(first, tokens, finish=finish, to_error=_stream_error),
        media_type="text/event-stream", headers=SSE_HEADERS)


async def _find_topic(vector_store, topic: str, top_k: int, min_chars: int = 0) -> Retrieval:
    """Retrieve for a topic and make sure the document really covers it (similarity gate), so the model is
    never asked to write about something that isn't in the PDF."""
    found = await asyncio.to_thread(retrieve, vector_store, topic, top_k)
    if min_chars and (not found.context or len(found.context.strip()) < min_chars):
        raise AppError("topic_not_found", f"Not enough content for '{topic}'. Try a topic from your document.", status_code=400)
    ensure_topic_covered(found, topic)
    logger.info("topic %s", describe(found))
    return found


async def _generation_key(kind: str, user: dict, session_id: str, topic: str, options: dict) -> tuple:
    """Cache key of a generated quiz / flashcard set / notes: this user, this document's content, topic, options, model."""
    doc = await asyncio.to_thread(documents.get_document, session_id, user["user_id"])
    return cache_key(kind, user_id=user["user_id"], file_hash=doc["file_hash"], topic=topic, options=options,
                     model=request_model_id())


def _record_flashcards(user: dict, session_id: str, topic: str) -> Optional[dict]:
    user_id = str(user["user_id"])
    history_service.log_activity(
        user_id=user["user_id"], session_id=session_id,
        mode="flashcards", action_type="generate", content={"topic": topic}
    )
    # Track quest progress + award XP/coins
    store.ensure_user(user_id)
    quest_service.get_or_create_daily_quests(user_id)
    quest_service.on_action(user_id, "flashcard_complete")
    quest_service.mark_maintained_streak(user_id)
    return reward_service.award(
        user_id=user_id, action_type="flashcard_complete",
        accuracy=1.0, difficulty=1.0, combo_count=1
    )


def _record_quiz(user: dict) -> None:
    user_id = str(user['user_id'])
    # NOTE: Quest tracking (complete_quizzes) happens when the quiz is finished (POST /quiz/finish awards
    # quiz_complete). We must NOT also track it here or each quiz would count twice.
    store.ensure_user(user_id)
    _q_progress = store.get_progress(user_id)
    quest_service.get_or_create_daily_quests(user_id, progress=_q_progress)
    quest_service.mark_maintained_streak(user_id)  # tracks maintain_streak quest only


def _record_notes(user: dict) -> Optional[dict]:
    user_id = str(user['user_id'])
    # Track quest progress
    quest_service.get_or_create_daily_quests(user_id)
    quest_service.on_action(user_id, "notes_generation")  # tracks generate_notes quest
    quest_service.mark_maintained_streak(user_id)  # tracks maintain_streak quest
    return reward_service.award(
        user_id=user_id, action_type="notes_generation",
        accuracy=1.0, difficulty=1.0, combo_count=1
    )


@router.post("/flashcards", response_model=FlashcardsResponse, response_model_exclude_unset=True)
@limiter.limit("20/minute")
async def flashcards(req: FlashcardRequest, request: Request, user=Depends(inject_user_llm_key)):
    try:
        topic = validate_topic(req.topic)
    except ValueError as e:
        raise invalid_input(str(e))
    num_cards = max(1, min(int(req.num_cards), 30))   # was unbounded → unbounded LLM cost
    vector_store = await documents.get_index(req.session_id, user['user_id'])
    key = await _generation_key("flashcards", user, req.session_id, topic, {"num_cards": num_cards})
    result = generation_cache.get(key)
    if result is None:
        found = await _find_topic(vector_store, topic, 12)      # raises topic_not_found if the PDF doesn't cover it
        context = found.context
        try:
            result = await asyncio.to_thread(generate_flashcards, context, topic, num_cards=num_cards)
        except Exception as _llm_e:
            raise_quota_if_needed(_llm_e)
            logger.exception("flashcards failed")
            raise generation_failed("Flashcard generation failed. Please try again.")
        generation_cache.put(key, result)
    result["rewards"] = await asyncio.to_thread(_record_flashcards, user, req.session_id, topic)
    return result


@router.post("/study/flashcards/review", response_model=FlashcardReviewResponse, response_model_exclude_unset=True)
@limiter.limit("120/minute")
async def flashcard_review(req: FlashcardReviewRequest, request: Request, user=Depends(require_auth)):
    """Self-graded flashcard review: "I knew it" / "I didn't" counts for the concept's mastery on this document
    (what /arena/weak-concepts and a Nemesis are built from)."""
    require_valid_session_id(req.session_id)
    concept = " ".join(req.concept.split())
    if not concept or len(concept) > 200:
        raise invalid_input("Concept must be 1-200 characters.")
    doc = await asyncio.to_thread(documents.get_document, req.session_id, user["user_id"])     # ownership
    row = await asyncio.to_thread(mastery_service.record, user["user_id"], doc["file_hash"], concept, req.correct)
    return {"ok": True, "concept": concept, "mastery": row}


@router.get("/study/review-deck", response_model=ReviewDeckResponse, response_model_exclude_unset=True)
async def review_deck(session_id: str, limit: int = 50, user=Depends(require_auth)):
    """Flashcards made from the questions the user got wrong on this document (arena and quizzes), newest first.
    Built from stored data only - no AI call."""
    require_valid_session_id(session_id)
    doc = await asyncio.to_thread(documents.get_document, session_id, user["user_id"])
    cards = await asyncio.to_thread(mastery_service.review_deck, user["user_id"], doc["file_hash"], max(1, min(limit, 100)))
    return {"ok": True, "cards": cards, "total": len(cards)}


@router.post("/quiz", response_model=QuizResponse, response_model_exclude_unset=True)
@limiter.limit("20/minute")
async def quiz(req: QuizRequest, request: Request, user=Depends(inject_user_llm_key)):
    try:
        top_k = validate_top_k(req.top_k)
        topic = validate_topic(req.topic)
    except ValueError as e:
        raise invalid_input(str(e))   # was an unhandled 500

    if req.num_questions < 1:
        req.num_questions = 3
    elif req.num_questions > 20:
        req.num_questions = 20

    vector_store = await documents.get_index(req.session_id, user['user_id'])

    await asyncio.to_thread(
        history_service.log_activity,
        user_id=user['user_id'], session_id=req.session_id,
        mode='quiz', action_type='generate',
        content={'topic': topic, 'num_questions': req.num_questions, 'question_type': req.question_type}
    )

    key = await _generation_key("quiz", user, req.session_id, topic, {
        "top_k": top_k, "num_questions": req.num_questions, "question_type": req.question_type})
    cached = generation_cache.get(key)
    if cached is not None:
        quiz_data, sources = cached["content"], cached["sources"]
    else:
        # Prevents hallucinated content when the topic has no presence in the uploaded PDF.
        found = await _find_topic(vector_store, topic, top_k, min_chars=50)
        context, sources = found.context, found.sources

        try:
            quiz_data = await generate_quiz_async(context=context, num_questions=req.num_questions, question_type=req.question_type)
        except Exception as e:
            raise_quota_if_needed(e)
            logger.exception("Quiz generation failed")
            raise generation_failed("Quiz generation failed. Please try again.")

        if not quiz_data or not quiz_data.get("questions"):
            raise generation_failed("No questions could be generated. Please try again.")
        generation_cache.put(key, {"content": quiz_data, "sources": sources})

    await asyncio.to_thread(_record_quiz, user)

    # The correct answers stay on the server under a quiz_id; the browser gets the questions without them.
    stored = await asyncio.to_thread(
        quiz_service.create, str(user['user_id']), req.session_id, topic, req.question_type, quiz_data)
    return {"mode": "quiz", "quiz_id": stored["quiz_id"], "content": stored["content"], "sources": sources}


@router.post("/quiz/answer", response_model=QuizAnswerResponse, response_model_exclude_unset=True)
@limiter.limit("120/minute")
async def quiz_answer(req: QuizAnswerRequest, request: Request, user=Depends(require_auth)):
    return await asyncio.to_thread(
        quiz_service.answer, str(user['user_id']), req.quiz_id, req.question_id, req.answer)


@router.post("/quiz/finish", response_model=QuizFinishResponse, response_model_exclude_unset=True)
@limiter.limit("30/minute")
async def quiz_finish(req: QuizFinishRequest, request: Request, user=Depends(require_auth)):
    return await asyncio.to_thread(quiz_service.finish, str(user['user_id']), req.quiz_id)


@router.post("/notes", response_model=NotesResponse, response_model_exclude_unset=True)
@limiter.limit("20/minute")
async def notes(req: NotesRequest, request: Request, user=Depends(inject_user_llm_key)):
    try:
        top_k = validate_top_k(req.top_k)
        topic = validate_topic(req.topic)
    except ValueError as e:
        raise invalid_input(str(e))   # was an unhandled 500
    detail_level = (req.detail_level or "")[:60]

    vector_store = await documents.get_index(req.session_id, user['user_id'])

    await asyncio.to_thread(
        history_service.log_activity,
        user_id=user['user_id'], session_id=req.session_id,
        mode='notes', action_type='generate',
        content={'topic': topic, 'detail_level': detail_level}
    )

    key = await _generation_key("notes", user, req.session_id, topic, {"top_k": top_k, "detail_level": detail_level})
    cached = generation_cache.get(key)
    if cached is not None:
        notes_content, sources = cached["content"], cached["sources"]
    else:
        found = await _find_topic(vector_store, topic, top_k, min_chars=50)
        context, sources = found.context, found.sources

        try:
            notes_content = await asyncio.to_thread(generate_notes, context, detail_level=detail_level)
        except Exception as _llm_e:
            raise_quota_if_needed(_llm_e)
            logger.exception("Notes generation failed")
            raise generation_failed("Notes generation failed. Please try again.")
        generation_cache.put(key, {"content": notes_content, "sources": sources})

    reward_payload = await asyncio.to_thread(_record_notes, user)

    return {"mode": "notes", "content": notes_content, "sources": sources, "rewards": reward_payload}
