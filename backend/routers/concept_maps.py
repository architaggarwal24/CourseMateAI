"""The concept map of a document or a course. Rules: services/concept_map_service.py."""
import asyncio

from fastapi import APIRouter, Depends, Request

from deps import inject_user_llm_key, require_auth
from schemas.concept_map import ConceptMapBuildRequest, ConceptMapResponse
from services import entitlements
from services.session_service import require_valid_session_id
from state import concept_map_service, limiter

router = APIRouter()


@router.get("/concept-map", response_model=ConceptMapResponse, response_model_exclude_unset=True)
async def get_concept_map(session_id: str, user=Depends(require_auth)):
    """The map as it is now (never starts any work): ready, building (with its progress line), or none yet."""
    entitlements.require(user["user_id"], "concept_map")
    require_valid_session_id(session_id)
    return await asyncio.to_thread(concept_map_service.view, user["user_id"], session_id)


@router.post("/concept-map", response_model=ConceptMapResponse, response_model_exclude_unset=True)
@limiter.limit("10/minute")
async def build_concept_map(req: ConceptMapBuildRequest, request: Request, user=Depends(inject_user_llm_key)):
    """Make the map of every document in the scope that has none yet: one AI call per document, run in the
    background (poll GET /concept-map). Documents already mapped are reused, at no cost."""
    entitlements.require(user["user_id"], "concept_map")
    require_valid_session_id(req.session_id)
    return await concept_map_service.build(user["user_id"], req.session_id)
