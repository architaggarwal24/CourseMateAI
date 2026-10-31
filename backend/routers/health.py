"""Liveness (/health) and readiness (/ready)."""
import asyncio

from fastapi import APIRouter

from errors import AppError
from rag.embeddings import embedding_model_loaded
from schemas.health import HealthResponse, ReadyResponse
from state import documents, store

router = APIRouter()


@router.get("/health", response_model=HealthResponse, response_model_exclude_unset=True)
def health_check():
    """Liveness: the process is up and answering. Touches nothing else, so a slow database or a model still
    downloading can never make an orchestrator restart a healthy process."""
    return {"status": "healthy"}


def _check_database() -> bool:
    try:
        return store.fetchone("SELECT 1 AS ok") is not None
    except Exception:
        return False


@router.get("/ready", response_model=ReadyResponse, response_model_exclude_unset=True)
async def readiness_check():
    """Readiness: the database answers and the embedding model is loaded - i.e. uploads, chat and quizzes work.
    503 until then (the first start downloads the model, which takes a few minutes)."""
    checks = {
        "database": "ok" if await asyncio.to_thread(_check_database) else "failing",
        "embedding_model": "ok" if embedding_model_loaded() else "loading",
    }
    if any(v != "ok" for v in checks.values()):
        raise AppError("not_ready", "The service is starting up. Try again in a moment.", status_code=503,
                       action="retry", details={"checks": checks})
    return {"status": "ready", "checks": checks, "active_sessions": await asyncio.to_thread(documents.count_ready)}
