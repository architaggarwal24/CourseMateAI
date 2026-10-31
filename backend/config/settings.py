"""Application settings: read ONCE at startup, validated, then immutable.

`load_settings()` is the only place the app reads its configuration from the
environment (a backend/.env file is loaded first, real environment variables win).
Missing or malformed values stop the process at startup with one message that lists
everything that is wrong, instead of failing on the first request that needs them.

Two modules deliberately keep reading the environment when they are used, because
they are switched at runtime and their tests rely on that:
  * key_service.py  - ENCRYPTION_KEY / ALLOW_INSECURE_DEV_KEY / SECRET_KEY (lazy Fernet)
  * providers.py    - ENABLE_OLLAMA / ALLOW_LOCAL_PROVIDERS
"""
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Mapping, Optional, Tuple

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parent.parent

# Provider env vars used as a fallback when a user has no saved key, in priority order.
_FALLBACK_LLM_ENV: Tuple[Tuple[str, str], ...] = (
    ("GOOGLE_API_KEY", "gemini"),
    ("NVIDIA_API_KEY", "nvidia-nim"),
    ("OPENAI_API_KEY", "openai"),
    ("ANTHROPIC_API_KEY", "claude"),
)

DEFAULT_EMBEDDING_MODEL = "BAAI/bge-large-en-v1.5"

_JWT_HINT = 'Generate one with: python -c "import secrets; print(secrets.token_hex(32))"'
_FERNET_HINT = ('Generate one with: python -c "from cryptography.fernet import Fernet; '
                'print(Fernet.generate_key().decode())"')


class SettingsError(RuntimeError):
    """The environment is missing required values or contains malformed ones."""


@dataclass(frozen=True)
class Settings:
    # ── secrets (never shown in repr / logs) ──
    jwt_secret: str = field(repr=False)
    encryption_key: str = field(repr=False)
    # (provider id, api key) pairs from the environment, in priority order
    fallback_llm_keys: Tuple[Tuple[str, str], ...] = field(repr=False)
    allow_insecure_dev_key: bool

    # ── HTTP ──
    allowed_origins: List[str]
    cookie_secure: bool            # always mark the login cookie Secure (it is also marked when the request arrived over https)
    backend_host: str
    backend_port: int

    # ── storage ──
    data_dir: Path
    database_path: Path        # the single SQLite file (data_dir/coursemate.db)
    upload_dir: Path
    max_file_size: int

    # ── sessions ──
    session_expiry_hours: int
    max_sessions: int
    max_sessions_per_user: int

    # ── documents / RAG ──
    embedding_model: str       # sentence-transformers model used to index AND query documents
    index_concurrency: int     # PDFs indexed at the same time (the rest wait in the queue)

    # ── retrieval ──
    # Relevance = cosine similarity (0..1) between the question and the best retrieved chunk.
    relevance_block_below: float     # chat: best chunk below this -> "I cannot find ... in the uploaded PDF"
    relevance_clarify_below: float   # chat: below this (but above block) -> answer with a clarification request
    topic_min_similarity: float      # quiz / notes / flashcards: topic's best chunk below this -> "not covered in your PDF"
    retrieval_mmr_lambda: float      # 1.0 = pure relevance, 0.0 = pure diversity (MMR top-k)
    query_rewrite: bool              # rewrite follow-up questions into standalone ones before searching
    query_rewrite_turns: int         # how many of the latest messages the rewrite sees
    generation_cache_ttl: int        # seconds a generated quiz / flashcard set / notes is reused for the same request; 0 = off

    # ── runtime switches ──
    skip_warmup: bool
    metrics_enabled: bool            # serve GET /metrics (LLM call count / latency / error class); off unless asked for


def _int(env: Mapping[str, str], name: str, default: int, problems: List[str]) -> int:
    raw = env.get(name, "")
    if raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        problems.append(f"{name} must be a whole number, got {raw!r}.")
        return default


def _float(env: Mapping[str, str], name: str, default: float, problems: List[str],
           lo: float = 0.0, hi: float = 1.0) -> float:
    raw = env.get(name, "")
    if raw == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        problems.append(f"{name} must be a number, got {raw!r}.")
        return default
    if not lo <= value <= hi:
        problems.append(f"{name} must be between {lo} and {hi}, got {value}.")
        return default
    return value


def _check_fernet_key(raw: str) -> Optional[str]:
    from cryptography.fernet import Fernet
    try:
        Fernet(raw.encode())
    except Exception as exc:
        return (f"ENCRYPTION_KEY is invalid: {exc}. It must be a valid Fernet key "
                f"(URL-safe base64, 32 bytes). {_FERNET_HINT}")
    return None


def load_settings(env: Optional[Mapping[str, str]] = None) -> Settings:
    """Build and validate Settings. Pass `env` (a plain dict) to test without touching os.environ."""
    if env is None:
        load_dotenv()          # real environment variables take precedence over .env
        env = os.environ

    problems: List[str] = []

    # FIX #8 (kept): never fall back to a hard-coded JWT secret - anyone reading the repo could forge tokens.
    jwt_secret = env.get("JWT_SECRET", "")
    if not jwt_secret:
        problems.append(f"JWT_SECRET is required but not set. {_JWT_HINT} and add it to backend/.env as JWT_SECRET=<value>.")

    allow_insecure = env.get("ALLOW_INSECURE_DEV_KEY", "").lower() == "true"
    encryption_key = env.get("ENCRYPTION_KEY", "")
    if encryption_key:
        bad = _check_fernet_key(encryption_key)
        if bad:
            problems.append(bad)
    elif not allow_insecure:
        problems.append(f"ENCRYPTION_KEY is required but not set. {_FERNET_HINT} and add it to backend/.env as ENCRYPTION_KEY=<value>.")

    origins = ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000"]
    extra_origin = env.get("ALLOWED_ORIGIN", "")
    if extra_origin:
        origins.append(extra_origin)

    session_expiry_hours = _int(env, "SESSION_EXPIRY_HOURS", 24, problems)   # idle time, not age
    max_sessions = _int(env, "MAX_SESSIONS", 100, problems)                  # global cap
    max_sessions_per_user = _int(env, "MAX_SESSIONS_PER_USER", 10, problems) # one user can't evict everyone
    backend_port = _int(env, "BACKEND_PORT", 8000, problems)
    index_concurrency = _int(env, "INDEX_CONCURRENCY", 2, problems)
    if index_concurrency < 1:
        problems.append(f"INDEX_CONCURRENCY must be at least 1, got {index_concurrency}.")
    # Default unchanged. A smaller local model (e.g. BAAI/bge-small-en-v1.5) needs far less RAM and CPU.
    embedding_model = (env.get("EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL).strip()

    # Retrieval thresholds are cosine similarities. The defaults are conservative starting points for the
    # bge models; the best chunk's score is logged for every chat question so they can be tuned per corpus.
    relevance_block_below = _float(env, "RELEVANCE_BLOCK_BELOW", 0.30, problems)
    relevance_clarify_below = _float(env, "RELEVANCE_CLARIFY_BELOW", 0.45, problems)
    if relevance_block_below > relevance_clarify_below:
        problems.append("RELEVANCE_BLOCK_BELOW must not be higher than RELEVANCE_CLARIFY_BELOW "
                        f"({relevance_block_below} > {relevance_clarify_below}).")
    topic_min_similarity = _float(env, "TOPIC_MIN_SIMILARITY", 0.40, problems)
    retrieval_mmr_lambda = _float(env, "RETRIEVAL_MMR_LAMBDA", 0.7, problems)
    query_rewrite_turns = _int(env, "QUERY_REWRITE_TURNS", 6, problems)
    if query_rewrite_turns < 1:
        problems.append(f"QUERY_REWRITE_TURNS must be at least 1, got {query_rewrite_turns}.")
    generation_cache_ttl = _int(env, "GENERATION_CACHE_TTL", 3600, problems)
    if generation_cache_ttl < 0:
        problems.append(f"GENERATION_CACHE_TTL must be 0 (off) or more seconds, got {generation_cache_ttl}.")

    if problems:
        raise SettingsError(
            "Invalid configuration - fix the following in backend/.env (or your environment) and restart:\n"
            + "\n".join(f"  - {p}" for p in problems)
        )

    data_dir = Path(env.get("COURSEMATE_DATA_DIR", str(_BACKEND_DIR / "data")))

    return Settings(
        jwt_secret=jwt_secret,
        encryption_key=encryption_key,
        fallback_llm_keys=tuple((provider, env[var]) for var, provider in _FALLBACK_LLM_ENV if env.get(var, "")),
        allow_insecure_dev_key=allow_insecure,
        allowed_origins=origins,
        cookie_secure=env.get("COOKIE_SECURE", "false").lower() == "true",
        backend_host=env.get("BACKEND_HOST", "0.0.0.0"),
        backend_port=backend_port,
        # Overridable so tests (and Docker volumes) never touch the real data directory.
        data_dir=data_dir,
        database_path=data_dir / "coursemate.db",
        upload_dir=Path(env.get("COURSEMATE_UPLOAD_DIR", str(_BACKEND_DIR / "uploads"))),
        max_file_size=50 * 1024 * 1024,  # 50 MB
        session_expiry_hours=session_expiry_hours,
        max_sessions=max_sessions,
        max_sessions_per_user=max_sessions_per_user,
        embedding_model=embedding_model,
        index_concurrency=index_concurrency,
        relevance_block_below=relevance_block_below,
        relevance_clarify_below=relevance_clarify_below,
        topic_min_similarity=topic_min_similarity,
        retrieval_mmr_lambda=retrieval_mmr_lambda,
        query_rewrite=env.get("QUERY_REWRITE", "true").strip().lower() not in ("false", "0", "no", "off"),
        query_rewrite_turns=query_rewrite_turns,
        generation_cache_ttl=generation_cache_ttl,
        skip_warmup=env.get("COURSEMATE_SKIP_WARMUP") == "1",
        metrics_enabled=env.get("METRICS_ENABLED", "false").strip().lower() in ("true", "1", "yes", "on"),
    )


try:
    settings = load_settings()
except SettingsError as _exc:
    print(f"\nERROR: {_exc}\n", file=sys.stderr)
    sys.exit(1)

# Module-level aliases kept so existing `from config import X` imports keep working.
ALLOWED_ORIGINS = settings.allowed_origins
DATA_DIR = settings.data_dir
UPLOAD_DIR = settings.upload_dir
SESSION_EXPIRY_HOURS = settings.session_expiry_hours
MAX_SESSIONS = settings.max_sessions
MAX_SESSIONS_PER_USER = settings.max_sessions_per_user
MAX_FILE_SIZE = settings.max_file_size
BACKEND_HOST = settings.backend_host
BACKEND_PORT = settings.backend_port
STATIC_DIR = "static"
