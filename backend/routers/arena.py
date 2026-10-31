"""Arena boss fights. /arena/battles/* is the server-authoritative fight (see services/arena_service.py),
/arena/runs/* the Expedition roguelite (services/expedition_service.py), /arena/weak-concepts what a Nemesis is made
of (services/mastery_service.py); the rest is the leaderboards."""
import asyncio
import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Request

from core_brains.boss_brain import VALID_DIFFICULTIES, extract_expedition_acts_async, generate_boss_persona_async
from errors import AppError, generation_failed, invalid_input, session_expired
from deps import inject_user_llm_key, raise_quota_if_needed, require_auth
from schemas.arena import (
    BattleActiveResponse, BattleAnswerRequest, BattleAnswerResponse, BattleCreateRequest, BattleForfeitResponse,
    BattleItemRequest, BattleItemResponse, BattleQuestionResponse, BattleResponse, BattleSpellRequest,
    BattleSpellResponse, LeaderboardResponse, RunChooseRequest, RunChooseResponse, RunCreateRequest,
    RunLeaderboardResponse, RunResponse, RunTravelRequest, RunTravelResponse, WeakConceptsResponse,
)
from services.arena_service import GenerationUnavailable
from services.mastery_service import NEMESIS_MIN_CONCEPTS
from services.session_service import require_valid_session_id
from state import battle_service, documents, expedition_service, limiter, mastery_service, quest_service, store
from utils.validators import validate_topic

logger = logging.getLogger(__name__)
router = APIRouter()

NEMESIS_TARGETS = 5                     # a Nemesis is built from (at most) this many of the weakest concepts


def nemesis_targets(user_id: str, doc_hash: str) -> List[str]:
    """The weak concepts a Nemesis boss is made of. 409 not_enough_data below NEMESIS_MIN_CONCEPTS."""
    total = mastery_service.missed_count(user_id, doc_hash)
    if total < NEMESIS_MIN_CONCEPTS:
        raise AppError("not_enough_data", f"A Nemesis needs at least {NEMESIS_MIN_CONCEPTS} concepts you have missed "
                       "on this document. Keep playing, quizzing and reviewing first.", status_code=409,
                       details={"missed_concepts": total, "needed": NEMESIS_MIN_CONCEPTS})
    return [c["concept"] for c in mastery_service.weak_concepts(user_id, doc_hash, NEMESIS_TARGETS)]


def nemesis_topic(targets: List[str]) -> str:
    return ("Nemesis: " + ", ".join(targets))[:100]


@router.get("/arena/leaderboard", response_model=LeaderboardResponse, response_model_exclude_unset=True)
def arena_leaderboard_get(difficulty: str, topic: str = "", session_id: str = "", date: str = "",
                          scope: Literal["topic", "global"] = "topic", user=Depends(require_auth)):
    """scope=topic (default): the board for topic + difficulty (+ the document, when session_id is given).
    scope=global: this week's board for the difficulty across every topic and document (entries carry the topic).
    Each player's best WON battle; rows are written by the server when a battle ends - there is no way to submit
    one. `date` is ignored (the boards are no longer daily) and only accepted so older clients keep working."""
    if difficulty not in VALID_DIFFICULTIES:
        raise invalid_input("Invalid difficulty.")
    if scope == "topic" and not topic.strip():
        raise invalid_input("Topic is required for a topic board.")
    doc_hash = None
    if session_id and scope == "topic":
        doc_hash = documents.get_document(session_id, user["user_id"])["file_hash"]
    entries = battle_service.leaderboard(user["user_id"], topic, difficulty, doc_hash, scope=scope)
    return {"ok": True, "date": date or "", "scope": scope, "entries": entries, "total": len(entries)}


@router.get("/arena/weak-concepts", response_model=WeakConceptsResponse, response_model_exclude_unset=True)
async def arena_weak_concepts(session_id: str, limit: int = 8, user=Depends(require_auth)):
    """The concepts of this document the user keeps missing (arena, quizzes, flashcard reviews), weakest first:
    weighted by misses, the current wrong streak and how recent the last miss was."""
    require_valid_session_id(session_id)
    doc_hash = (await asyncio.to_thread(documents.get_document, session_id, user["user_id"]))["file_hash"]
    concepts = await asyncio.to_thread(mastery_service.weak_concepts, user["user_id"], doc_hash, max(1, min(limit, 30)))
    total = await asyncio.to_thread(mastery_service.missed_count, user["user_id"], doc_hash)
    return {"ok": True, "concepts": concepts, "missed_total": total, "nemesis_ready": total >= NEMESIS_MIN_CONCEPTS}


# ══════════════════════════ server-authoritative battles ══════════════════════════
def _retryable(exc: GenerationUnavailable) -> AppError:
    """Questions couldn't be generated: the battle is untouched, so the caller may simply ask again."""
    raise_quota_if_needed(exc.cause)
    return AppError("battle_generation_failed", "The boss is gathering its thoughts. Please try again in a moment.",
                    status_code=503, action="retry", details={"retryable": True})


@router.post("/arena/battles", response_model=BattleResponse, response_model_exclude_unset=True)
@limiter.limit("10/minute")
async def arena_battle_create(request: Request, req: BattleCreateRequest, user=Depends(inject_user_llm_key)):
    """Start a battle (or resume the one already running on this document with the same topic and difficulty).
    Returns the boss and the battle_id - never an answer."""
    user_id = str(user["user_id"])
    mode = req.mode
    if mode == "quick":
        try:
            topic = validate_topic(req.topic)
        except ValueError as e:
            raise invalid_input(str(e))
    difficulty = req.difficulty
    if difficulty not in VALID_DIFFICULTIES:
        raise invalid_input(f"Difficulty must be one of: {', '.join(VALID_DIFFICULTIES)}.")
    vector_store = await documents.get_index(req.session_id, user["user_id"])      # ownership + ready
    if not vector_store:
        raise session_expired()
    doc_hash = documents.get_document(req.session_id, user["user_id"])["file_hash"]
    targets = None
    if mode == "nemesis":
        targets = await asyncio.to_thread(nemesis_targets, user_id, doc_hash)
        topic = nemesis_topic(targets)

    existing = await asyncio.to_thread(battle_service.find_active, user_id, req.session_id)
    if existing:
        same = existing["mode"] == mode and existing["difficulty"] == difficulty and (
            mode == "nemesis" or existing["topic"] == topic)
        if same:
            battle_service.prefetch(existing["id"], user_id)
            return {"ok": True, "battle_id": existing["id"], "resumed": True,
                    "boss": battle_service.public_boss(existing), "battle": battle_service.state(existing)}
        raise AppError("battle_in_progress", "You already have a battle running for this document. Finish or forfeit it first.",
                       status_code=409, details={"battle_id": existing["id"]})

    try:
        boss = await generate_boss_persona_async(vector_store, topic, difficulty=difficulty)
    except Exception as _llm_e:
        raise_quota_if_needed(_llm_e)
        raise generation_failed("Boss generation failed. Please try again.")
    battle = await asyncio.to_thread(
        lambda: battle_service.create(user_id, req.session_id, doc_hash, topic, difficulty, boss, mode=mode,
                                      target_concepts=targets))

    store.ensure_user(user_id)
    quest_service.get_or_create_daily_quests(user_id)
    quest_service.mark_maintained_streak(user_id)
    battle_service.prefetch(battle["id"], user_id)           # phase 1, then phase 2, in the background
    if boss.get("flavor_pending"):
        battle_service.enrich(battle["id"], user_id)          # topic-specific lines, also in the background
    return {"ok": True, "battle_id": battle["id"], "resumed": False, "boss": battle_service.public_boss(battle),
            "battle": battle_service.state(battle)}


@router.get("/arena/battles/active", response_model=BattleActiveResponse, response_model_exclude_unset=True)
async def arena_battle_active(session_id: str = "", user=Depends(require_auth)):
    """The battle in progress, if any (on this document when session_id is given, otherwise the latest one):
    how a page refresh - or a new tab - finds its fight again."""
    if session_id:
        require_valid_session_id(session_id)
    b = await asyncio.to_thread(battle_service.find_active, str(user["user_id"]), session_id)
    if not b:
        return {"ok": True, "battle": None}
    return {"ok": True, "battle": {**battle_service.state(b), "boss_profile": battle_service.public_boss(b)}}


@router.get("/arena/battles/{battle_id}", response_model=BattleResponse, response_model_exclude_unset=True)
async def arena_battle_get(battle_id: str, user=Depends(require_auth)):
    b = await asyncio.to_thread(battle_service.get, str(user["user_id"]), battle_id)
    return {"ok": True, "battle_id": b["id"], "boss": battle_service.public_boss(b), "battle": battle_service.state(b)}


@router.get("/arena/battles/{battle_id}/question", response_model=BattleQuestionResponse,
            response_model_exclude_unset=True)
@limiter.limit("120/minute")
async def arena_battle_question(request: Request, battle_id: str, move: Optional[str] = None,
                               user=Depends(inject_user_llm_key)):
    """The next question for `move` (strike - the default - | jab | heavy | guard): the move picks the question's
    tier and time limit; heavy's Focus is paid now (409 not_enough_focus when short). Options shuffled by the
    server, no correct answer, and a server-side deadline. Asking again (refresh, restart) returns the same
    question - with the move it was issued for - and the time that is left."""
    try:
        result = await battle_service.next_question(str(user["user_id"]), battle_id, move)
    except GenerationUnavailable as exc:
        raise _retryable(exc)
    stock = await asyncio.to_thread(battle_service.stock, str(user["user_id"]))
    return {"ok": True, **result, "stock": stock}


@router.post("/arena/battles/{battle_id}/answer", response_model=BattleAnswerResponse, response_model_exclude_unset=True)
@limiter.limit("120/minute")
async def arena_battle_answer(request: Request, battle_id: str, req: BattleAnswerRequest,
                              user=Depends(inject_user_llm_key)):
    """Grade an answer on the server and apply the damage. The first answer to a question is final."""
    user_id = str(user["user_id"])
    result = await asyncio.to_thread(battle_service.answer, user_id, battle_id, req.question_id, req.answer)
    battle_service.prefetch(battle_id, user_id)              # e.g. the rage phase just began: keep its pool warm
    return result


@router.post("/arena/battles/{battle_id}/items", response_model=BattleItemResponse, response_model_exclude_unset=True)
@limiter.limit("60/minute")
async def arena_battle_item(request: Request, battle_id: str, req: BattleItemRequest, user=Depends(require_auth)):
    """Use a heal or 50/50 in this battle. Only items the user owns are consumed."""
    return await asyncio.to_thread(battle_service.use_item, str(user["user_id"]), battle_id, req.item)


@router.post("/arena/battles/{battle_id}/spells", response_model=BattleSpellResponse, response_model_exclude_unset=True)
@limiter.limit("60/minute")
async def arena_battle_spell(request: Request, battle_id: str, req: BattleSpellRequest, user=Depends(require_auth)):
    """Cast a spell on the open question, paid with Focus: insight (two wrong options go) or timewarp (+15 s).
    Each works once per question."""
    return await asyncio.to_thread(battle_service.cast_spell, str(user["user_id"]), battle_id, req.spell)


@router.post("/arena/battles/{battle_id}/forfeit", response_model=BattleForfeitResponse,
             response_model_exclude_unset=True)
async def arena_battle_forfeit(battle_id: str, user=Depends(require_auth)):
    """Retreat: the battle is lost."""
    return await asyncio.to_thread(battle_service.forfeit, str(user["user_id"]), battle_id)


# ══════════════════════════ Expedition runs ══════════════════════════
@router.post("/arena/runs", response_model=RunResponse, response_model_exclude_unset=True)
@limiter.limit("10/minute")
async def arena_run_create(request: Request, req: RunCreateRequest, user=Depends(inject_user_llm_key)):
    """Start an Expedition through the document (or resume the one already running on it with the same difficulty;
    another difficulty is 409 run_in_progress with details {run_id, difficulty}). The LLM names the 3 acts once,
    here; every act's map then comes from the run's stored seed."""
    user_id = str(user["user_id"])
    if req.difficulty not in VALID_DIFFICULTIES:
        raise invalid_input(f"Difficulty must be one of: {', '.join(VALID_DIFFICULTIES)}.")
    vector_store = await documents.get_index(req.session_id, user["user_id"])      # ownership + ready
    if not vector_store:
        raise session_expired()
    doc_hash = documents.get_document(req.session_id, user["user_id"])["file_hash"]
    existing = await asyncio.to_thread(expedition_service.find_active, user_id, req.session_id)
    if existing:
        if existing["difficulty"] != req.difficulty:
            raise AppError("run_in_progress", "You already have an expedition running on this document. "
                           "Finish or abandon it first.", status_code=409,
                           details={"run_id": existing["id"], "difficulty": existing["difficulty"]})
        return {"ok": True, "resumed": True, "run": expedition_service.state(existing)}
    try:
        acts = await extract_expedition_acts_async(vector_store, 3)
    except Exception as _llm_e:
        raise_quota_if_needed(_llm_e)
        raise generation_failed("The expedition map could not be drawn. Please try again.")
    run = await asyncio.to_thread(expedition_service.create, user_id, req.session_id, doc_hash, req.difficulty, acts)
    store.ensure_user(user_id)
    quest_service.get_or_create_daily_quests(user_id)
    quest_service.mark_maintained_streak(user_id)
    return {"ok": True, "resumed": False, "run": expedition_service.state(run)}


@router.get("/arena/runs/active", response_model=RunResponse, response_model_exclude_unset=True)
async def arena_run_active(session_id: str = "", user=Depends(require_auth)):
    """The run in progress on this document when session_id is given; otherwise the latest active run whose document
    can still be loaded (one whose upload expired only if nothing else is left - see run.document_ready), or null."""
    if session_id:
        require_valid_session_id(session_id)
    run = await asyncio.to_thread(expedition_service.find_active, str(user["user_id"]), session_id or None)
    return {"ok": True, "run": expedition_service.state(run) if run else None}


@router.get("/arena/runs/leaderboard", response_model=RunLeaderboardResponse, response_model_exclude_unset=True)
async def arena_run_leaderboard(scope: Literal["document", "global"] = "document", session_id: str = "",
                                user=Depends(require_auth)):
    """Best finished run per player by score: on one document (session_id, all time) or global (this week)."""
    doc_hash = None
    if scope == "document":
        if not session_id:
            raise invalid_input("session_id is required for a document board.")
        doc_hash = (await asyncio.to_thread(documents.get_document, session_id, user["user_id"]))["file_hash"]
    entries = await asyncio.to_thread(expedition_service.leaderboard, str(user["user_id"]), scope, doc_hash)
    return {"ok": True, "scope": scope, "entries": entries, "total": len(entries)}


@router.get("/arena/runs/{run_id}", response_model=RunResponse, response_model_exclude_unset=True)
async def arena_run_get(run_id: str, user=Depends(require_auth)):
    run = await asyncio.to_thread(expedition_service.get, str(user["user_id"]), run_id)
    return {"ok": True, "run": expedition_service.state(run)}


@router.post("/arena/runs/{run_id}/travel", response_model=RunTravelResponse, response_model_exclude_unset=True)
@limiter.limit("30/minute")
async def arena_run_travel(request: Request, run_id: str, req: RunTravelRequest, user=Depends(inject_user_llm_key)):
    """Move to a reachable node. A fight node (battle / elite / nemesis / boss) starts a battle (play it with the
    /arena/battles/{battle_id} endpoints; its end flows back into the run). rest / shop leave a pending choice;
    treasure gives a relic at once. 409 node_unreachable / choice_pending / battle_in_progress."""
    user_id = str(user["user_id"])
    plan = await asyncio.to_thread(expedition_service.plan_travel, user_id, run_id, req.node_id)
    boss = None
    if plan["fight"]:
        run = await asyncio.to_thread(expedition_service.get, user_id, run_id)
        vector_store = await documents.get_index(run["session_id"], user["user_id"])
        if not vector_store:
            raise session_expired()
        try:
            boss = await generate_boss_persona_async(vector_store, plan["topic"], difficulty=plan["difficulty"])
        except Exception as _llm_e:              # the run is untouched: travelling again simply retries
            raise_quota_if_needed(_llm_e)
            raise generation_failed("The boss could not be summoned. Please try again.")
    result = await asyncio.to_thread(expedition_service.travel, user_id, run_id, req.node_id, boss)
    if result.get("battle_id"):
        battle_service.prefetch(result["battle_id"], user_id)
        if boss and boss.get("flavor_pending"):
            battle_service.enrich(result["battle_id"], user_id)
    return {"ok": True, **result}


@router.post("/arena/runs/{run_id}/choose", response_model=RunChooseResponse, response_model_exclude_unset=True)
@limiter.limit("60/minute")
async def arena_run_choose(request: Request, run_id: str, req: RunChooseRequest, user=Depends(require_auth)):
    """Answer the pending choice: rest (heal | study + target concept), shop (buy + target item id | leave),
    relic offer (take + target relic id | skip)."""
    result = await asyncio.to_thread(expedition_service.choose, str(user["user_id"]), run_id, req.action, req.target)
    return {"ok": True, **result}


@router.post("/arena/runs/{run_id}/abandon", response_model=RunResponse, response_model_exclude_unset=True)
async def arena_run_abandon(run_id: str, user=Depends(require_auth)):
    """Give up the run (a fight in progress is lost). Pays the run's expedition_complete for the depth reached."""
    return await asyncio.to_thread(expedition_service.abandon, str(user["user_id"]), run_id)
