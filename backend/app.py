"""FastAPI application: lifespan, middleware, rate-limit handler and router wiring.

`main.py` re-exports `app` from here so `uvicorn main:app` keeps working.
"""
import asyncio
import logging
import warnings
from contextlib import asynccontextmanager

import os  # noqa: E402

# Library chatter off: one line per HTTP call to the model hub / LLM, the embedding model's progress bars, faiss's
# CPU-feature probing. Our own request log line already says what happened (and how long it took).
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
for _noisy in ("huggingface_hub", "urllib3.connectionpool", "httpx", "httpx2", "httpcore", "faiss", "faiss.loader",
               "sentence_transformers", "transformers", "openai", "langchain"):
    logging.getLogger(_noisy).setLevel(logging.ERROR if _noisy.startswith(("huggingface", "urllib3")) else logging.WARNING)
warnings.filterwarnings("ignore", message=".*ConnectionResetError.*")
warnings.filterwarnings("ignore", message=".*Retrying.*")

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from config import settings  # noqa: E402
from errors import register_handlers  # noqa: E402
from observability import RequestContextMiddleware, configure_logging, install_metrics_endpoint  # noqa: E402
from routers import arena, auth, avatar, documents, health, progression, shop, study  # noqa: E402
from state import auth_service, documents as document_service, history_service, limiter  # noqa: E402

# JSON log lines on stdout; the app's own secrets are blanked from anything written (see observability/logs.py).
configure_logging(secrets=[settings.jwt_secret, settings.encryption_key, *(key for _, key in settings.fallback_llm_keys)])

logger = logging.getLogger(__name__)


async def _periodic_cleanup(interval_seconds: int = 1800):
    """Run session cleanup and log pruning every 30 min in the background."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            document_service.cleanup()
        except Exception as exc:
            logger.warning(f"Periodic session cleanup error: {exc}")
        try:
            auth_service.purge_expired_sessions()
        except Exception as exc:
            logger.warning(f"Periodic session purge error: {exc}")
        try:
            history_service.prune_old_logs()
        except Exception as exc:
            logger.warning(f"Periodic log prune error: {exc}")


@asynccontextmanager
async def lifespan(app):
    """Handle startup (session restore) and periodic cleanup."""
    # The documents table is the source of truth: reconcile it (legacy import, embedding-model check,
    # requeue anything a previous process left half-indexed). Indexes themselves load lazily on first use.
    try:
        stats = await asyncio.to_thread(document_service.startup)
        logger.info(f"Documents reconciled: {stats}")
    except Exception as exc:
        logger.warning(f"Document startup reconcile failed: {exc}")

    # Warm the embedding model in the background. Otherwise the FIRST upload/chat of
    # a fresh install silently downloads a ~1.3 GB model while the user stares at a
    # spinner. Set COURSEMATE_SKIP_WARMUP=1 to disable (tests do).
    warmup = None
    if not settings.skip_warmup:
        async def _warm():
            try:
                from rag.embeddings import get_embedding_model
                await asyncio.to_thread(get_embedding_model)
                logger.info("Embedding model ready")
            except Exception as exc:
                logger.warning(f"Embedding warm-up failed (will retry on first use): {exc}")
        warmup = asyncio.create_task(_warm())

    task = asyncio.create_task(_periodic_cleanup())
    yield
    for t in (task, warmup):
        if t is None:
            continue
        t.cancel()
        try:
            await t
        except asyncio.CancelledError:
            pass


app = FastAPI(title="CourseMateAI", version="2.0.0", lifespan=lifespan)

# ============================
# MIDDLEWARE
# ============================
# `limiter` itself lives in state.py (the routers decorate with it, so it can't be defined
# here without a circular import); it is wired into the app below.
app.state.limiter = limiter


register_handlers(app)   # one error shape for every failure (see errors.py)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    # Only what the app uses: its routes are GET/POST/PUT/DELETE, JSON bodies (Content-Type) and an optional
    # bearer token. The browser app itself is same-origin (Next.js rewrite), so this serves other front ends.
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

# Outermost: every response (CORS preflights and errors included) carries X-Request-ID, and every request gets one log line.
app.add_middleware(RequestContextMiddleware)

# ============================
# ROUTERS
# ============================
API_PREFIX = "/api/v1"
for _router in (auth, study, documents, arena, progression, shop, avatar, health):
    app.include_router(_router.router, prefix=API_PREFIX)

if settings.metrics_enabled:
    install_metrics_endpoint(app)

