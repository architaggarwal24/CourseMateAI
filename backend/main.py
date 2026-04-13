from typing import Dict, Optional, List, Literal
import json
import asyncio
import os
import logging
import warnings
from contextlib import asynccontextmanager
import bcrypt

# Suppress noisy HuggingFace Hub connection retry warnings
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)
warnings.filterwarnings("ignore", message=".*ConnectionResetError.*")
warnings.filterwarnings("ignore", message=".*Retrying.*")

logger = logging.getLogger(__name__)

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Depends, Response, Request, BackgroundTasks
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from auth.auth_service import AuthService
from auth.middleware import AuthMiddleware
from database.db import Database
from config import ALLOWED_ORIGINS, STATIC_DIR
from middleware import set_vector_stores
from services import handle_pdf_upload, get_vector_store, get_context_for_query, validate_context_quality, validate_topic_in_pdf
from services.session_service import cleanup_sessions
from services.history_service import HistoryService
from core_brains.chat_brain import chat_with_context
from core_brains.notes_brain import generate_notes
from core_brains.quiz_brain import generate_quiz_async
from core_brains.boss_brain import (
    generate_boss_persona, generate_battle_quiz,
    generate_boss_persona_async, generate_battle_quiz_async,
    apply_player_attack, boss_attack, boss_taunt,
)
from core_brains.flashcard_brain import generate_flashcards
from core_brains.llm_connection import ask_llm, ask_llm_with_key, set_request_key, clear_request_key, QuotaExceededError
from key_service import encrypt_key, decrypt_key, validate_api_key, SUPPORTED_PROVIDERS
from utils.validators import validate_question, validate_top_k
from services.progression.db import SQLiteStore
from services.progression.shop_service import ShopService
from services.progression.reward_service import RewardService
from services.progression.quest_service import DailyQuestService
from services.progression.achievement_service import AchievementService
from services.progression.buff_service import BuffService
from services.progression.achievements_catalog import ACHIEVEMENTS
from services.progression.progression import xp_progress

# ============================
# APP INIT
# ============================

def _raise_quota_if_needed(exc: Exception):
    """Convert QuotaExceededError → clean HTTP 429 the frontend understands."""
    if isinstance(exc, QuotaExceededError):
        raise HTTPException(
            status_code=429,
            detail={
                "message": f"You have exceeded your API quota for {exc.provider}. Check your usage or upgrade your plan.",
                "usage_url": exc.usage_url,
                "provider": exc.provider,
            }
        )



async def _periodic_cleanup(interval_seconds: int = 1800):
    """Run session cleanup and log pruning every 30 min in the background."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            cleanup_sessions(vector_stores)
        except Exception as exc:
            logger.warning(f"Periodic session cleanup error: {exc}")
        try:
            history_service.prune_old_logs()
        except Exception as exc:
            logger.warning(f"Periodic log prune error: {exc}")


@asynccontextmanager
async def lifespan(app):
    """Handle startup (session restore) and periodic cleanup."""
    import json as _json
    from pathlib import Path as _Path
    from rag.vectorstore import VectorStore as _VS
    from datetime import datetime as _dt

    upload_dir = _Path(__file__).resolve().parent / "uploads"
    if upload_dir.exists():
        restored = 0
        for meta_path in upload_dir.glob("*_meta.json"):
            session_id = meta_path.stem.replace("_meta", "")
            index_path = upload_dir / f"{session_id}_index"
            if not index_path.exists():
                continue
            try:
                vs = _VS.load(str(index_path))
                meta = _json.loads(meta_path.read_text())
                vector_stores[session_id] = {
                    "store": vs, "store_path": str(index_path),
                    "created_at": _dt.now(), **meta,
                }
                restored += 1
            except Exception as e:
                logger.warning(f"Could not restore session {session_id}: {e}")
        if restored:
            logger.info(f"Restored {restored} sessions from disk")

    task = asyncio.create_task(_periodic_cleanup())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="CourseMateAI", version="2.0.0", lifespan=lifespan)

db = Database(os.path.join(os.path.dirname(__file__), "data", "app.db"))
# FIX #8: Never fall back to a hardcoded secret in production.
# The string "dev-secret-change-in-production" is publicly visible in source code.
# Anyone who reads the repo can forge a valid JWT for any user_id and authenticate
# as any user without knowing their password.
# We fail fast so operators know immediately rather than running insecurely.
jwt_secret = os.getenv("JWT_SECRET", "")
if not jwt_secret:
    import sys
    print(
        "\nERROR: JWT_SECRET environment variable is required but not set.\n"
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\"\n"
        "Then add it to your .env file as: JWT_SECRET=<generated_value>\n",
        file=sys.stderr,
    )
    sys.exit(1)
auth_service = AuthService(db, secret_key=jwt_secret)
auth_middleware = AuthMiddleware(auth_service)
history_service = HistoryService(db)

progression_db_path = os.path.join(os.path.dirname(__file__), "data", "progression.db")
store = SQLiteStore(progression_db_path)
store.init_db()

# In-memory leaderboard cache — defined before the pre-load block below
_leaderboard_store: dict = {}  # date_topic_difficulty → list[entry]

# Create leaderboard table if it doesn't exist (persistent across restarts)
try:
    store.execute("""
        CREATE TABLE IF NOT EXISTS leaderboard (
            date TEXT NOT NULL,
            topic TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            grade TEXT,
            accuracy INTEGER DEFAULT 0,
            time_seconds INTEGER DEFAULT 9999,
            PRIMARY KEY (date, topic, difficulty, user_id)
        )
    """)
except Exception as _lb_err:
    logger.warning(f"Could not create leaderboard table: {_lb_err}")

# Pre-load today's leaderboard rows from DB into the in-memory store
try:
    import datetime as _dt_mod
    _today = _dt_mod.date.today().isoformat()
    rows = store.fetchall(
        "SELECT * FROM leaderboard WHERE date = ?", (_today,)
    )
    for row in (rows or []):
        _key = f"{row['date']}_{row['topic']}_{row['difficulty']}"
        if _key not in _leaderboard_store:
            _leaderboard_store[_key] = []
        _leaderboard_store[_key].append({
            "user_id":  row["user_id"],
            "username": row["username"],
            "grade":    row.get("grade", "F"),
            "accuracy": row.get("accuracy", 0),
            "time":     row.get("time_seconds", 9999),
            "date":     row["date"],
        })
    for key in _leaderboard_store:
        _leaderboard_store[key].sort(key=lambda e: (-e["accuracy"], e["time"]))
        _leaderboard_store[key] = _leaderboard_store[key][:100]
except Exception as _lb_load_err:
    logger.warning(f"Could not pre-load leaderboard: {_lb_load_err}")

achievement_service = AchievementService(store)
achievement_service.seed(ACHIEVEMENTS)
buff_service = BuffService(store)
reward_service = RewardService(store, achievement_service, buff_service)
shop_service = ShopService(store, buff_service=buff_service)
quest_service = DailyQuestService(store)

vector_stores: Dict[str, Dict] = {}
set_vector_stores(vector_stores)

# In-memory cache: ArenaView stores pre-fetched boss+questions here,
# game.js reads them on init — same server, no cross-origin localStorage issue
# FIX BUG 53: Wrap in a simple TTL store to prevent unbounded growth.
import time as _time

class _TTLCache:
    """Simple TTL-evicting dict. Entries expire after ttl_seconds."""
    def __init__(self, ttl_seconds: int = 3600):
        self._data: Dict[str, tuple] = {}  # key → (value, expires_at)
        self._ttl = ttl_seconds

    def get(self, key: str):
        entry = self._data.get(key)
        if entry is None:
            return None
        if _time.time() >= entry[1]:
            # Expired — evict on read so stale entries don't linger
            del self._data[key]
            return None
        return entry[0]

    def set(self, key: str, value):
        self._evict_expired()
        self._data[key] = (value, _time.time() + self._ttl)

    def _evict_expired(self):
        now = _time.time()
        self._data = {k: v for k, v in self._data.items() if v[1] > now}

    def __contains__(self, key: str):
        return self.get(key) is not None

    def __setitem__(self, key: str, value):
        self.set(key, value)

    def __getitem__(self, key: str):
        val = self.get(key)
        if val is None:
            raise KeyError(key)
        return val

prefetch_cache: _TTLCache = _TTLCache(ttl_seconds=3600)  # 1-hour TTL






# ============================
# MIDDLEWARE
# ============================
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    # FIX: Added PUT — was missing, causing OPTIONS preflight for PUT /auth/api-key
    # to return 400, which blocked the browser from ever sending the actual request.
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"]
)

static_path = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_path), name="static")


# ============================
# HELPER
# ============================
async def get_optional_user(request: Request) -> Optional[dict]:
    """Returns user dict if authenticated, None if guest."""
    try:
        return await auth_middleware.get_current_user(request)
    except Exception:
        return None

def _check_session_ownership(session_id: str, user_id: str, vector_stores: dict):
    """Raise 403 if the session does not belong to the requesting user."""
    session_data = vector_stores.get(session_id)
    if session_data and session_data.get("user_id") and session_data["user_id"] != str(user_id):
        raise HTTPException(status_code=403, detail="Not your session")




# ============================
# MODELS
# ============================
class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    username: str
    full_name: str
    guest_id: Optional[str] = None
    api_key: str
    # BUG REMOVED: default was "mistral" — silently saved wrong provider for Gemini/OpenAI/Claude users
    llm_provider: str = ""
    llm_model: Optional[str] = None


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[str] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


class QuizRequest(BaseModel):
    topic: str
    num_questions: int
    question_type: Literal["MCQ", "True/False", "Mixed"]
    session_id: str


class NotesRequest(BaseModel):
    topic: str
    detail_level: str
    session_id: str


class FlashcardRequest(BaseModel):
    topic: str
    session_id: str


class RewardAwardRequest(BaseModel):
    user_id: str
    action_type: str
    accuracy: float = 1.0
    difficulty: float = 1.0
    combo_count: int = 1


class QuestClaimRequest(BaseModel):
    user_id: str
    quest_type: str


class ShopPurchaseRequest(BaseModel):
    item_id: str
    user_id: Optional[str] = None  # ignored — auth token is always used


class ShopEquipRequest(BaseModel):
    item_id: str
    user_id: Optional[str] = None  # ignored — auth token is always used


class AvatarUpdateRequest(BaseModel):
    user_id: str
    equipped: dict = Field(default_factory=dict)
    skin_id: str = ""
    hair_id: str = ""
    outfit_id: str = ""


class AvatarConfigRequest(BaseModel):
    """Save hero-forge customization: skin, hair, outfit, headgear, weapon, pet"""
    body_type_id: str = ""
    skin_id:      str = ""
    hair_id:      str = ""
    eye_color_id: str = ""
    lip_color_id: str = ""
    outfit_id:    str = ""
    headgear:     str = ""
    weapon:       str = ""
    pet:          str = ""




class ShopUnequipRequest(BaseModel):
    user_id: str  # Ignored, using auth
    slot: str  # "headgear", "armor", "weapon", "pet", or "title"


class UseItemRequest(BaseModel):
    item_id: str




# ── API Key management ────────────────────────────────────────────────────────

def _get_user_llm(user: dict):
    """Fetch the user's decrypted API key, provider and model. Returns (key, provider, model)."""
    key_data = db.get_api_key_data(user["user_id"])
    if not key_data or not key_data.get("api_key_encrypted"):
        for env_var, provider in [
            ("OPENAI_API_KEY", "openai"),
            ("GOOGLE_API_KEY", "gemini"),
            ("ANTHROPIC_API_KEY", "claude"),
            ("MISTRAL_API_KEY", "mistral"),
        ]:
            val = os.getenv(env_var, "")
            if val:
                return val, provider, None
        return "", "", None  # no key anywhere — ask_llm() raises a clear error to the user
    return (
        decrypt_key(key_data["api_key_encrypted"]),
        key_data.get("llm_provider", ""),
        key_data.get("llm_model"),
    )


async def inject_user_llm_key(user=Depends(auth_middleware.require_auth)):
    """FastAPI dependency: sets the thread-local LLM key for this request."""
    api_key, provider, model = _get_user_llm(user)
    set_request_key(api_key, provider, model)
    try:
        yield user
    finally:
        clear_request_key()


class ApiKeyRequest(BaseModel):
    api_key: str
    # BUG REMOVED: default was "mistral" — silently saved wrong provider when updating key
    llm_provider: str = ""
    # FIX #1: llm_model was missing. update_api_key called req.llm_model which raised
    # AttributeError on every PUT /auth/api-key request, meaning "Save Key" in Settings
    # always returned a 500 error and users could never update their API key.
    llm_model: Optional[str] = None


@app.get("/auth/api-key")
async def get_api_key_info(user=Depends(auth_middleware.require_auth)):
    """Return the provider name (never the actual key)."""
    key_data = db.get_api_key_data(user["user_id"])
    if not key_data or not key_data.get("api_key_encrypted"):
        return {"has_key": False, "provider": None}
    return {"has_key": True, "provider": key_data.get("llm_provider")}


@app.put("/auth/api-key")
async def update_api_key(req: ApiKeyRequest, user=Depends(auth_middleware.require_auth)):
    """Validate and replace the user's API key."""
    ok, err = validate_api_key(req.llm_provider, req.api_key, req.llm_model)
    if not ok:
        raise HTTPException(status_code=400, detail=f"Invalid API key: {err}")
    encrypted = encrypt_key(req.api_key)
    # FIX #4: Pass req.llm_model as the 4th argument. The old code omitted it,
    # so every key update silently set the model to NULL in the database, reverting
    # users to the hardcoded default model even after they'd chosen a specific one.
    db.save_api_key(user["user_id"], encrypted, req.llm_provider, req.llm_model)
    return {"success": True, "provider": req.llm_provider}





@app.post("/auth/register")
@limiter.limit("10/minute")
async def register(req: RegisterRequest, response: Response, request: Request):
    """Register a new user, validate their API key, then log them in."""
    ok, err = validate_api_key(req.llm_provider, req.api_key, req.llm_model)
    if not ok:
        raise HTTPException(status_code=400, detail=f"Invalid API key: {err}")
    try:
        user = auth_service.register_user(
            email=req.email, password=req.password,
            username=req.username, full_name=req.full_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    encrypted = encrypt_key(req.api_key)
    db.save_api_key(user["user_id"], encrypted, req.llm_provider, req.llm_model)
    store.ensure_user(str(user["user_id"]))
    token = auth_service.login(req.email, req.password)
    if token:
        response.set_cookie(
            key="session_token", value=token,
            httponly=True, secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
            samesite="lax", max_age=7 * 24 * 60 * 60,
        )
    return {"success": True, "user_id": user["user_id"], "username": user["username"]}

@app.post("/auth/login")
@limiter.limit("5/minute")
async def login(req: LoginRequest, response: Response, request: Request):
    token = auth_service.login(req.email, req.password)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    response.set_cookie(
        key="session_token", value=token,
        httponly=True, secure=os.getenv("COOKIE_SECURE", "false").lower() == "true", samesite="lax",
        max_age=7 * 24 * 60 * 60
    )
    return {"success": True}


@app.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("session_token")
    return {"success": True}


@app.get("/auth/me")
async def get_current_user(user=Depends(auth_middleware.require_auth)):
    return user


@app.get("/auth/check-username")
async def check_username(username: str):
    if len(username) < 3:
        return {"available": False, "reason": "too_short"}
    existing = db.get_user_by_username(username)
    return {"available": existing is None, "username": username}


@app.post("/auth/update-profile")
async def update_profile(req: UpdateProfileRequest, user=Depends(auth_middleware.require_auth)):
    user_id = user['user_id']
    current_user = db.get_user_by_id(user_id)
    if not current_user:
        raise HTTPException(status_code=404, detail="User not found")
    updates = {}
    if req.full_name and req.full_name != current_user.get('full_name'):
        updates['full_name'] = req.full_name.strip()
    if req.username and req.username != current_user.get('username'):
        if len(req.username) < 3:
            raise HTTPException(status_code=400, detail="Username too short")
        if db.get_user_by_username(req.username):
            raise HTTPException(status_code=400, detail="Username taken")
        updates['username'] = req.username
    if req.email and req.email != current_user.get('email'):
        if db.get_user_by_email(req.email):
            raise HTTPException(status_code=400, detail="Email in use")
        updates['email'] = req.email
    if req.new_password:
        if not req.current_password:
            raise HTTPException(status_code=400, detail="Current password required")
        if not bcrypt.checkpw(req.current_password.encode('utf-8'), current_user['password_hash'].encode('utf-8')):
            raise HTTPException(status_code=401, detail="Wrong password")
        if len(req.new_password) < 8:
            raise HTTPException(status_code=400, detail="Password too short")
        password_hash = bcrypt.hashpw(req.new_password.encode('utf-8'), bcrypt.gensalt())
        updates['password_hash'] = password_hash.decode('utf-8')
    if updates:
        update_fields = ", ".join([f"{k} = ?" for k in updates.keys()])
        values = list(updates.values()) + [user_id]
        db.execute(f"UPDATE users SET {update_fields} WHERE id = ?", tuple(values))
        return {"success": True, "message": "Profile updated"}
    return {"success": True, "message": "No changes"}


@app.delete("/auth/delete-account")
def delete_account(user=Depends(auth_middleware.require_auth)):
    user_id = user['user_id']
    try:
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        # FIX BUG 2: Use store (progression.db) not db (app.db) to delete
        # progression data. user_progress and related tables live in progression.db.
        # Using db.execute() silently failed — the tables don't exist in app.db.
        for sql in [
            "DELETE FROM user_progress WHERE user_id = ?",
            "DELETE FROM daily_quests WHERE user_id = ?",
            "DELETE FROM user_achievements WHERE user_id = ?",
            "DELETE FROM user_avatar WHERE user_id = ?",
            "DELETE FROM daily_action_counts WHERE user_id = ?",
            "DELETE FROM user_buffs WHERE user_id = ?",
            "DELETE FROM user_inventory WHERE user_id = ?",
        ]:
            try:
                store.execute(sql, (str(user_id),))
            except Exception:
                pass
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================
# HISTORY
# ============================
@app.get("/history")
async def get_history(mode: str = None, limit: int = 100, user=Depends(auth_middleware.require_auth)):
    history = history_service.get_user_history(user_id=user['user_id'], mode=mode, limit=limit)
    return {"history": history}


@app.get("/history/session/{session_id}")
async def get_session_history(session_id: str, user=Depends(auth_middleware.require_auth)):
    _check_session_ownership(session_id, user["user_id"], vector_stores)
    history = history_service.get_session_history(session_id)
    return {"history": history}


# ============================
# UPLOAD
# ============================
@app.post("/upload")
async def upload_pdf(
        file: UploadFile = File(...),
        session_id: str = Form(None),
        background_tasks: BackgroundTasks = None,
        user=Depends(auth_middleware.require_auth)
):
    # FIX BUG-F09: Run session cleanup as a background task on every upload.
    # Without this, vector_stores grows unbounded — every uploaded PDF stays in RAM forever.
    if background_tasks is not None:
        background_tasks.add_task(cleanup_sessions, vector_stores)
    result = await handle_pdf_upload(file, session_id, vector_stores, user_id=str(user['user_id']))
    history_service.log_activity(
        user_id=user['user_id'], session_id=session_id or "unknown",
        mode='upload', action_type='pdf_upload', content={'filename': file.filename}
    )
    return result


# ============================
# CHAT
# ============================
class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    question: str
    session_id: str
    # FIX BUG 5: Pydantic v1 shares mutable defaults across instances.
    # Use Field(default_factory=list) to ensure each request gets its own list.
    history: list = Field(default_factory=list)


@app.post("/chat")
@limiter.limit("30/minute")
async def chat(req: ChatRequest, request: Request, background_tasks: BackgroundTasks, top_k: int = 5, user=Depends(inject_user_llm_key)):
    user_id = str(user['user_id'])
    # FIX BUG 4: Wrap validator calls — they raise ValueError which FastAPI
    # does NOT auto-convert to 422; it becomes a 500. Catch and re-raise as HTTP 400.
    try:
        question = validate_question(req.question)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        top_k = validate_top_k(top_k)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    history = (req.history or [])[-20:]  # Cap to last 20 turns to prevent context-window/cost DoS

    background_tasks.add_task(
        history_service.log_activity,
        user_id=user['user_id'], session_id=req.session_id,
        mode='chat', action_type='query', content={'question': question}
    )

    _check_session_ownership(req.session_id, user['user_id'], vector_stores)
    vector_store = get_vector_store(req.session_id, vector_stores)
    context, sources = get_context_for_query(vector_store, question, top_k)
    quality = validate_context_quality(context, question)

    if quality["blocked"]:
        return {"mode": "chat", "content": f'I cannot find "{question}" in the uploaded PDF.', "sources": [],
                "blocked": True}

    if quality["needs_clarification"]:
        clarification_context = f"The following content was found:\n\n{context}\n\nIf relevant, explain it. Otherwise, ask the user to clarify."
        answer = chat_with_context(question, clarification_context, history)
        history_service.log_activity(
            user_id=user['user_id'], session_id=req.session_id,
            mode='chat', action_type='response', content={'answer': answer, 'needs_clarification': True}
        )
        # Track quest progress even for clarification responses — this is still
        # a real question asked. Without this, follow-up questions in the same
        # chat never register toward the "Ask 10 questions" quest.
        q_strip = question.strip()
        if len(q_strip) >= 3 and any(c.isalpha() for c in q_strip):
            store.ensure_user(user_id)
            quest_service.get_or_create_daily_quests(user_id)
            quest_service.on_chat_question(user_id)
            quest_service.mark_maintained_streak(user_id)
        return {"mode": "chat", "content": answer, "sources": sources, "needs_clarification": True}

    try:
        answer = chat_with_context(question, context, history)
    except Exception as _llm_e:
        _raise_quota_if_needed(_llm_e)
        raise HTTPException(status_code=500, detail=str(_llm_e))
    session_id = req.session_id
    history_service.log_activity(
        user_id=user['user_id'], session_id=session_id,
        mode='chat', action_type='response', content={'answer': answer, 'sources': len(sources)}
    )

    reward_payload = None
    q = question.strip()
    # A question counts toward the quest if it has at least 3 chars and isn't
    # pure whitespace/punctuation. The old threshold (10 chars, 5 unique chars)
    # was too strict — short follow-up questions like "Why?" or "How?" are real
    # questions but were silently ignored, causing the "ask 10 questions" quest
    # to only register the first long question and skip all follow-ups.
    is_quality = (len(q) >= 3 and any(c.isalpha() for c in q))

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

    return {"mode": "chat", "content": answer, "sources": sources, "rewards": reward_payload}


# ============================
# QUIZ
# ============================
@app.post("/flashcards")
async def flashcards(req: FlashcardRequest, num_cards: int = 10, user=Depends(inject_user_llm_key)):
    user_id = str(user["user_id"])
    _check_session_ownership(req.session_id, user['user_id'], vector_stores)
    vector_store = get_vector_store(req.session_id, vector_stores)
    if not vector_store:
        raise HTTPException(status_code=400, detail="No PDF uploaded for this session")
    context = get_context_for_query(vector_store, req.topic, top_k=12)[0]
    # FIX BUG-F16: Actually call validate_topic_in_pdf (was defined but never called).
    validate_topic_in_pdf(context, req.topic)
    try:
        result = generate_flashcards(context, req.topic, num_cards=num_cards)
    except Exception as _llm_e:
        _raise_quota_if_needed(_llm_e)
        raise HTTPException(status_code=500, detail="Flashcard generation failed.")
    history_service.log_activity(
        user_id=user["user_id"], session_id=req.session_id,
        mode="flashcards", action_type="generate", content={"topic": req.topic}
    )
    # Track quest progress + award XP/coins
    store.ensure_user(user_id)
    quest_service.get_or_create_daily_quests(user_id)
    quest_service.on_action(user_id, "flashcard_complete")
    quest_service.mark_maintained_streak(user_id)
    reward_payload = reward_service.award(
        user_id=user_id, action_type="flashcard_complete",
        accuracy=1.0, difficulty=1.0, combo_count=1
    )
    result["rewards"] = reward_payload
    return result


@app.post("/quiz")
@limiter.limit("20/minute")
async def quiz(req: QuizRequest, request: Request, top_k: int = 5, user=Depends(inject_user_llm_key)):
    user_id = str(user['user_id'])
    top_k = validate_top_k(top_k)

    if req.num_questions < 1:
        req.num_questions = 3
    elif req.num_questions > 20:
        req.num_questions = 20

    history_service.log_activity(
        user_id=user['user_id'], session_id=req.session_id,
        mode='quiz', action_type='generate',
        content={'topic': req.topic, 'num_questions': req.num_questions, 'question_type': req.question_type}
    )

    _check_session_ownership(req.session_id, user['user_id'], vector_stores)
    vector_store = get_vector_store(req.session_id, vector_stores)
    if not vector_store:
        raise HTTPException(status_code=400, detail="No document uploaded.")

    context, sources = get_context_for_query(vector_store, req.topic, top_k)
    if not context or len(context.strip()) < 50:
        raise HTTPException(status_code=400, detail=f"Not enough content for '{req.topic}'.")
    # FIX BUG-F16: Actually call validate_topic_in_pdf (was defined but never called).
    # Prevents hallucinated content when the topic has no presence in the uploaded PDF.
    validate_topic_in_pdf(context, req.topic)

    try:
        quiz_data = await generate_quiz_async(context=context, num_questions=req.num_questions, question_type=req.question_type)
    except Exception as e:
        _raise_quota_if_needed(e)
        print(f"Quiz error: {e}")
        raise HTTPException(status_code=500, detail="Quiz generation failed.")

    if not quiz_data or not quiz_data.get("questions"):
        raise HTTPException(status_code=500, detail="No questions generated.")

    # NOTE: Quest tracking (complete_quizzes) happens in /rewards/award when the
    # frontend calls awardRewards("quiz_complete") after quiz completion.
    # We must NOT also track it here or each quiz would count twice.
    store.ensure_user(user_id)
    _q_progress = store.get_progress(user_id)
    quest_service.get_or_create_daily_quests(user_id, progress=_q_progress)
    quest_service.mark_maintained_streak(user_id)  # tracks maintain_streak quest only

    return {"mode": "quiz", "content": quiz_data, "sources": sources}


# ============================
# NOTES
# ============================
@app.post("/notes")
@limiter.limit("20/minute")
async def notes(req: NotesRequest, request: Request, top_k: int = 5, user=Depends(inject_user_llm_key)):
    user_id = str(user['user_id'])
    top_k = validate_top_k(top_k)

    history_service.log_activity(
        user_id=user['user_id'], session_id=req.session_id,
        mode='notes', action_type='generate',
        content={'topic': req.topic, 'detail_level': req.detail_level}
    )

    _check_session_ownership(req.session_id, user['user_id'], vector_stores)
    vector_store = get_vector_store(req.session_id, vector_stores)
    if not vector_store:
        raise HTTPException(status_code=400, detail="No document uploaded.")

    context, sources = get_context_for_query(vector_store, req.topic, top_k)
    if not context or len(context.strip()) < 50:
        raise HTTPException(status_code=400, detail=f"Not enough content for: {req.topic}.")
    # FIX BUG-F16: Actually call validate_topic_in_pdf (was defined but never called).
    validate_topic_in_pdf(context, req.topic)

    try:
        notes_content = generate_notes(context, detail_level=req.detail_level)
    except Exception as _llm_e:
        _raise_quota_if_needed(_llm_e)
        raise HTTPException(status_code=500, detail="Notes generation failed.")

    # Track quest progress
    quest_service.get_or_create_daily_quests(user_id)
    quest_service.on_action(user_id, "notes_generation")  # tracks generate_notes quest
    quest_service.mark_maintained_streak(user_id)  # tracks maintain_streak quest

    reward_payload = reward_service.award(
        user_id=user_id, action_type="notes_generation",
        accuracy=1.0, difficulty=1.0, combo_count=1
    )

    return {"mode": "notes", "content": notes_content, "sources": sources, "rewards": reward_payload}


# ============================
# ARENA
# ============================
@app.post("/arena/boss")
# FIX #3: Changed Depends(auth_middleware.require_auth) → Depends(inject_user_llm_key).
# The old code never injected the user's API key before calling generate_boss_persona(),
# which calls ask_llm() internally. ask_llm() reads from context storage — but without
# inject_user_llm_key, the key is never set, so it always raised:
#   ValueError: No API key configured. Please go to Settings → AI Provider and save your key.
# Also changed def → async def to avoid blocking the event loop during LLM calls.
async def arena_create_boss(topic: str, session_id: str, difficulty: str = "hard",
                      user=Depends(inject_user_llm_key)):
    user_id = str(user['user_id'])
    history_service.log_activity(
        user_id=user['user_id'], session_id=session_id,
        mode='arena', action_type='boss_summon', content={'topic': topic, 'difficulty': difficulty}
    )
    _check_session_ownership(session_id, user['user_id'], vector_stores)
    vector_store = get_vector_store(session_id, vector_stores)
    if not vector_store:
        raise HTTPException(status_code=400, detail="No document uploaded.")
    try:
        # Use async version so the event loop is never blocked during LLM calls
        boss = await generate_boss_persona_async(vector_store, topic, difficulty=difficulty)
    except Exception as _llm_e:
        _raise_quota_if_needed(_llm_e)
        raise HTTPException(status_code=500, detail="Boss generation failed.")
    boss["difficulty"] = difficulty

    # Add equipment-based hint bonus so game.js seeds hintCharges from equipped items
    eq_bonus = reward_service.get_equipment_bonuses(user_id)
    boss["equipment_arena_hints"] = int(eq_bonus.get("arena_hints", 0))

    # Track quest progress
    store.ensure_user(user_id)
    quest_service.get_or_create_daily_quests(user_id)
    quest_service.mark_maintained_streak(user_id)

    return boss


@app.post("/arena/prefetch")
def arena_store_prefetch(payload: dict, user=Depends(auth_middleware.require_auth)):
    """ArenaView calls this after summoning to cache boss+questions server-side.
    game.js then reads /arena/prefetch to skip all LLM calls on init."""
    session_id = payload.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    # Store owner so GET can verify the requesting user owns this session's data
    payload["_owner_id"] = str(user["user_id"])
    prefetch_cache[session_id] = payload
    return {"ok": True}


@app.get("/arena/prefetch")
def arena_get_prefetch(session_id: str, user=Depends(auth_middleware.require_auth)):
    """game.js calls this on init to get pre-fetched boss+questions instantly."""
    data = prefetch_cache.get(session_id)
    if not data:
        return {"ok": False}
    owner_id = data.get("_owner_id")
    if owner_id and owner_id != str(user["user_id"]):
        raise HTTPException(status_code=403, detail="Not your session")
    # Don't delete — allow page refresh to re-use
    return {"ok": True, **{k: v for k, v in data.items() if k != "_owner_id"}}


@app.post("/arena/quiz")
# FIX #3: Same fix as arena_create_boss — changed to inject_user_llm_key so the user's
# API key is set in context before generate_battle_quiz() calls ask_llm().
# Without this, all arena quiz generation fails with ValueError: No API key configured.
async def arena_quiz(
        topic: str, session_id: str, difficulty: str = "normal",
        num_questions: int = 5, phase: int = 1, asked_concepts: str = "",
        user=Depends(inject_user_llm_key)
):
    _check_session_ownership(session_id, user['user_id'], vector_stores)
    vector_store = get_vector_store(session_id, vector_stores)
    if not vector_store:
        raise HTTPException(status_code=400, detail="Upload a PDF first")
    concepts_list = [c.strip() for c in asked_concepts.split(",") if c.strip()] if asked_concepts else []
    try:
        # Use async version so the event loop is never blocked during LLM calls
        result = await generate_battle_quiz_async(
            vector_store, topic, difficulty=difficulty,
            num_questions=num_questions, asked_concepts=concepts_list, phase=phase
        )
    except Exception as _llm_e:
        _raise_quota_if_needed(_llm_e)
        raise HTTPException(status_code=500, detail="Battle quiz generation failed.")
    return result


@app.get("/profile")
async def get_profile(request: Request):
    user = await get_optional_user(request)
    if not user:
        return {"progress": {"current_level": 1, "total_xp": 0, "coins": 0, "xp_into_level": 0, "xp_to_next": 100},
                "avatar": {}, "guest_mode": True}
    user_id = str(user['user_id'])
    store.ensure_user(user_id)
    progress = store.get_progress(user_id)
    avatar = store.get_avatar(user_id)
    lvl, into, to_next = xp_progress(int(progress.get("total_xp", 0) or 0))
    return {"progress": {**progress, "xp_into_level": into, "xp_to_next": to_next}, "avatar": avatar,
            "guest_mode": False}


@app.post("/rewards/award")
def award_rewards(req: RewardAwardRequest, user=Depends(auth_middleware.require_auth)):
    user_id = str(user['user_id'])
    # FIX BUG-F15: Catch ValueError from calculate_rewards (unknown action_type) and
    # return 400 Bad Request instead of letting it propagate as a 500 Internal Server Error.
    try:
        return reward_service.award(
            user_id=user_id, action_type=req.action_type,
            accuracy=req.accuracy, difficulty=req.difficulty, combo_count=req.combo_count
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/daily-quests")
def get_daily_quests(user=Depends(auth_middleware.require_auth)):
    user_id = str(user['user_id'])
    return {"quests": quest_service.get_or_create_daily_quests(user_id)}


@app.post("/daily-quests/claim")
def claim_daily_quest(req: QuestClaimRequest, user=Depends(auth_middleware.require_auth)):
    user_id = str(user['user_id'])
    claim = quest_service.claim_quest(user_id, req.quest_type)
    if not claim.get("ok"):
        return claim
    bonus = reward_service.apply_bonus(
        user_id=user_id,
        xp=int(claim["reward_xp"]),
        coins=int(claim["reward_coins"]),
        source=f"daily_quest:{req.quest_type}"
    )
    # Ensure ok:True so frontend can detect success
    return {
        "ok": True,
        "xp_gained": bonus.get("xp_gained", claim["reward_xp"]),
        "coins_gained": bonus.get("coins_gained", claim["reward_coins"]),
        **bonus,
    }


@app.get("/shop")
def get_shop(user=Depends(auth_middleware.require_auth)):
    user_id = str(user['user_id'])
    return shop_service.get_shop_state(user_id)


@app.post("/shop/purchase")
def shop_purchase(req: ShopPurchaseRequest, user=Depends(auth_middleware.require_auth)):
    user_id = str(user['user_id'])
    return shop_service.purchase(user_id, req.item_id)


@app.post("/shop/equip")
def shop_equip(req: ShopEquipRequest, user=Depends(auth_middleware.require_auth)):
    user_id = str(user['user_id'])
    return shop_service.equip(user_id, req.item_id)


@app.post("/shop/unequip")
def shop_unequip(req: ShopUnequipRequest, user=Depends(auth_middleware.require_auth)):
    """Unequip an item from a specific equipment slot"""
    user_id = str(user['user_id'])
    return shop_service.unequip(user_id, req.slot)


@app.post("/items/use")
def use_item(req: UseItemRequest, user=Depends(auth_middleware.require_auth)):
    """Use a consumable item from inventory. Applies its effect immediately."""
    user_id = str(user['user_id'])

    # Look up item in catalog
    shop_state = shop_service.get_shop_state(user_id)
    item = next((i for i in shop_state["items"] if i["id"] == req.item_id), None)

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if not item.get("consumable"):
        raise HTTPException(status_code=400, detail="Item is not consumable")

    qty = item.get("quantity", 0) or 0
    if qty < 1:
        raise HTTPException(status_code=400, detail="You don't have this item in your inventory")

    effect = item.get("effect")
    if not effect:
        raise HTTPException(status_code=400, detail="Item has no effect defined")

    # Apply the buff
    result = buff_service.apply_buff(user_id, effect)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("reason", "Cannot use item right now"))

    # Consume from inventory
    consumed = store.consume_inventory_item(user_id, req.item_id)
    if not consumed:
        raise HTTPException(status_code=400, detail="Failed to consume item")

    active_buffs = buff_service.get_active_buffs(user_id)
    return {
        "ok": True,
        "item_id": req.item_id,
        "item_name": item["name"],
        "effect": effect,
        "message": result.get("message", "Item used!"),
        "expires_at": result.get("expires_at"),
        "active_buffs": active_buffs,
        # For hint_scroll: tell client how many charges are now available
        "hint_charges": active_buffs.get("hint_charges", {}).get("count", 0) if effect == "hint_charge" else None,
    }


@app.post("/arena/heal")
def arena_use_heal(user=Depends(auth_middleware.require_auth)):
    """
    Consume one heal charge in arena.
    Priority: buff slot first, then auto-pull from inventory.
    Returns ok=True with remaining_total count.
    """
    user_id = str(user['user_id'])

    # Try buff slot first (already activated heals)
    consumed = buff_service.consume_heal(user_id)

    if not consumed:
        # No buffed heal — check if there's one in inventory and auto-activate it
        shop_state = shop_service.get_shop_state(user_id)
        inv_item = next((i for i in shop_state["items"] if i["id"] == "potion_health_small"), None)
        inv_qty  = (inv_item.get("quantity") or 0) if inv_item else 0

        if inv_qty > 0:
            # Auto-apply from inventory (moves one from inv → buff, then consume it)
            apply_result = buff_service.apply_buff(user_id, "heal_1")
            if apply_result.get("ok"):
                store.consume_inventory_item(user_id, "potion_health_small")
                buff_service.consume_heal(user_id)
                consumed = True
            else:
                return {"ok": False, "reason": apply_result.get("reason", "Could not use potion")}
        else:
            return {"ok": False, "reason": "No health potions available. Buy some from the shop!"}

    # Return updated counts for the frontend to sync
    remaining_buff = buff_service.get_heal_count(user_id)
    shop_state = shop_service.get_shop_state(user_id)
    inv_item  = next((i for i in shop_state["items"] if i["id"] == "potion_health_small"), None)
    inv_qty   = (inv_item.get("quantity") or 0) if inv_item else 0
    remaining_total = remaining_buff + inv_qty

    return {"ok": True, "message": "Healed +1 HP!", "remaining_buff": remaining_buff,
            "remaining_inv": inv_qty, "remaining_total": remaining_total}


@app.post("/arena/hint-use")
def arena_use_hint(user=Depends(auth_middleware.require_auth)):
    """Legacy endpoint — kept for backwards compat, does nothing now."""
    return {"ok": True, "remaining": 0}


@app.post("/arena/fifty-fifty-use")
def arena_use_fifty_fifty(user=Depends(auth_middleware.require_auth)):
    """Consume one 50/50 charge in arena."""
    user_id = str(user['user_id'])
    remaining = buff_service.consume_fifty_fifty_charge(user_id)
    return {"ok": True, "remaining": remaining}


@app.post("/arena/buy")
def arena_buy_item(payload: dict, user=Depends(auth_middleware.require_auth)):
    """Buy a consumable in the arena phase shop. Routes through shop_service.purchase()
    so stack limits and coin deduction are atomic and consistent with the main shop.
    payload: { item_type: 'potion'|'fifty', cost: int }
    """
    user_id = str(user['user_id'])
    item_type = payload.get("item_type")

    item_id_map = {"potion": "potion_health_small", "fifty": "fifty_fifty"}
    item_id = item_id_map.get(item_type)
    if not item_id:
        return {"ok": False, "reason": "Unknown item type"}

    result = shop_service.purchase(user_id, item_id)
    if not result.get("ok"):
        return result

    progress = store.get_progress(user_id)
    return {"ok": True, "coins_remaining": int(progress.get("coins", 0) or 0)}


# ─── Daily Boss Leaderboard ─────────────────────────────────────────────────
@app.post("/arena/leaderboard")
def arena_leaderboard_submit(payload: dict, user=Depends(auth_middleware.require_auth)):
    """Submit a battle result to today's leaderboard (topic+difficulty scoped)."""
    date       = payload.get("date", "unknown")
    topic      = payload.get("topic", "general")
    difficulty = payload.get("difficulty", "hard")
    key = f"{date}||{topic}||{difficulty}"

    # Use the authenticated username from the auth token — never trust client-provided username
    db_user = db.get_user_by_id(user["user_id"])
    safe_username = (db_user or {}).get("username") or str(user["user_id"])[:8]

    entry = {
        "user_id":  str(user["user_id"]),
        "username": safe_username,
        "grade":    payload.get("grade", "F"),
        "accuracy": int(payload.get("accuracy", 0)),
        "time":     int(payload.get("time", 9999)),
        "date":     date,
    }
    if key not in _leaderboard_store:
        _leaderboard_store[key] = []
    # Remove previous entry for same user
    _leaderboard_store[key] = [e for e in _leaderboard_store[key] if e["user_id"] != entry["user_id"]]
    _leaderboard_store[key].append(entry)
    # Keep top 100 by accuracy desc, time asc
    _leaderboard_store[key].sort(key=lambda e: (-e["accuracy"], e["time"]))
    _leaderboard_store[key] = _leaderboard_store[key][:100]

    # Persist to DB so leaderboard survives server restarts
    try:
        store.execute(
            """INSERT OR REPLACE INTO leaderboard
               (date, topic, difficulty, user_id, username, grade, accuracy, time_seconds)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (date, topic, difficulty, entry["user_id"], entry["username"],
             entry["grade"], entry["accuracy"], entry["time"])
        )
    except Exception:
        pass  # Leaderboard persistence is best-effort

    return {"ok": True}


@app.get("/arena/leaderboard")
def arena_leaderboard_get(topic: str, difficulty: str, date: str = "",
                          user=Depends(auth_middleware.require_auth)):
    """Fetch the leaderboard for a given topic+difficulty (defaults to today)."""
    import datetime as _dt
    if not date:
        date = _dt.date.today().isoformat()
    key = f"{date}||{topic}||{difficulty}"
    entries = _leaderboard_store.get(key, [])
    my_id   = str(user["user_id"])
    # Annotate user's own entry
    ranked  = []
    for i, e in enumerate(entries):
        ranked.append({**e, "rank": i+1, "is_me": e["user_id"] == my_id})
    return {"ok": True, "date": date, "entries": ranked, "total": len(ranked)}



@app.get("/avatar")
def get_avatar(user=Depends(auth_middleware.require_auth)):
    user_id = str(user['user_id'])
    store.ensure_user(user_id)
    avatar = store.get_avatar(user_id)
    equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")
    owned = json.loads(avatar.get("owned_json", "[]") or "[]")
    return {
        "equipped": equipped,
        "owned": owned,
        "skin_id":      equipped.get("skin_id",      ""),
        "hair_id":      equipped.get("hair_id",      ""),
        "eye_color_id": equipped.get("eye_color_id", ""),
        "lip_color_id": equipped.get("lip_color_id", ""),
        "body_type_id": equipped.get("body_type_id", ""),
        "outfit_id":    equipped.get("outfit_id",    ""),
    }


@app.post("/avatar/update")
def update_avatar(req: AvatarUpdateRequest, user=Depends(auth_middleware.require_auth)):
    user_id = str(user['user_id'])
    store.ensure_user(user_id)
    avatar = store.get_avatar(user_id)
    owned = json.loads(avatar.get("owned_json", "[]") or "[]")
    equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")
    equipped.update(req.equipped or {})
    if req.skin_id: equipped["skin_id"] = req.skin_id
    if req.hair_id: equipped["hair_id"] = req.hair_id
    if req.outfit_id:
        equipped["outfit_id"] = req.outfit_id  # legacy compat
        equipped["armor"]     = req.outfit_id  # canonical shop key
    store.set_avatar(user_id, equipped=equipped, owned=owned)
    return {"ok": True, "equipped": equipped, "owned": owned}


@app.post("/avatar/hero-forge-save")
def hero_forge_save(req: AvatarConfigRequest, user=Depends(auth_middleware.require_auth)):
    """Save hero-forge customization (skin, hair, outfit + equipment)"""
    user_id = str(user['user_id'])
    store.ensure_user(user_id)
    avatar = store.get_avatar(user_id)
    owned = json.loads(avatar.get("owned_json", "[]") or "[]")
    equipped = json.loads(avatar.get("equipped_json", "{}") or "{}")

    # Store hero-forge cosmetic choices in equipped dict
    if req.body_type_id: equipped["body_type_id"] = req.body_type_id
    if req.skin_id:      equipped["skin_id"]      = req.skin_id
    if req.hair_id:      equipped["hair_id"]      = req.hair_id
    if req.eye_color_id: equipped["eye_color_id"] = req.eye_color_id
    if req.lip_color_id: equipped["lip_color_id"] = req.lip_color_id
    if req.outfit_id:
        equipped["outfit_id"] = req.outfit_id  # legacy compat
        equipped["armor"]     = req.outfit_id  # canonical shop key
    # Only update equipment slots if provided
    # FIX BUG 1: Check for "none" BEFORE the truthiness check.
    # "none" is truthy, so the old if/elif order set equipped[slot] = "none"
    # instead of deleting the slot. Checking == "none" first fixes the order.
    if req.headgear == "none":
        equipped.pop("headgear", None)
    elif req.headgear:
        equipped["headgear"] = req.headgear
    if req.weapon == "none":
        equipped.pop("weapon", None)
    elif req.weapon:
        equipped["weapon"] = req.weapon
    if req.pet == "none":
        equipped.pop("pet", None)
    elif req.pet:
        equipped["pet"] = req.pet

    store.set_avatar(user_id, equipped=equipped, owned=owned)
    return {"ok": True, "equipped": equipped}


# ============================
# HUD - works for both auth and guest
# ============================
@app.get("/hud")
async def get_hud(request: Request):
    user = await get_optional_user(request)

    if not user:
        return {
            "progress": {
                "current_level": 1, "total_xp": 0, "coins": 0,
                "xp_into_level": 0, "xp_to_next": 100,
                "total_chat_questions": 0, "total_quiz_questions": 0,
            },
            "quests": [],
            "shop": {"shop_unlocked": False, "level": 1, "coins": 0, "items": []},
            "guest_mode": True
        }

    user_id = str(user['user_id'])
    store.ensure_user(user_id)

    progress = store.get_progress(user_id)
    total_xp = int(progress.get("total_xp", 0) or 0)
    _, into, to_next = xp_progress(total_xp)
    progress_out = {**progress, "xp_into_level": into, "xp_to_next": to_next}

    # Pass pre-loaded progress to avoid redundant get_progress reads in sub-services
    quests = quest_service.get_or_create_daily_quests(user_id, progress=progress)

    level = int(progress.get("current_level", 1) or 1)
    if level < 5:
        shop = {"shop_unlocked": False, "level": level, "coins": int(progress.get("coins", 0) or 0), "items": []}
    else:
        shop = shop_service.get_shop_state(user_id, progress=progress)

    active_buffs = buff_service.get_active_buffs(user_id)

    # Always expose consumable inventory counts (independent of shop lock level)
    # so the sidebar can show correct totals for all users
    inv_rows = store.get_inventory(user_id)
    consumable_inventory = {r["item_id"]: int(r["quantity"]) for r in inv_rows}

    return {
        "progress": progress_out,
        "quests": quests,
        "shop": shop,
        "buffs": active_buffs,
        "consumable_inventory": consumable_inventory,
        "guest_mode": False,
    }


@app.post("/arena/sync-inventory")
def arena_sync_inventory(payload: dict, user=Depends(auth_middleware.require_auth)):
    """
    Called at the end of every arena battle (victory, defeat, or retreat).
    Writes the exact remaining counts of arena consumables back to inventory
    and clears any pending buff charges (since the battle is over).
    payload: { potion_health_small: N, fifty_fifty: N }
    """
    user_id      = str(user['user_id'])
    potion_count = max(0, int(payload.get("potion_health_small", 0)))
    fifty_count  = max(0, int(payload.get("fifty_fifty",         0)))

    # Enforce stack caps (safety guard — arena can't exceed shop limits)
    potion_count = min(potion_count, 3)
    fifty_count  = min(fifty_count,  2)

    # 1. Clear arena consumable buff entries — battle is over, no more in-flight charges
    active_buffs = buff_service.get_active_buffs(user_id)
    active_buffs.pop("heal_1",      None)
    active_buffs.pop("fifty_fifty", None)
    buff_service._save_buffs(user_id, active_buffs)

    # 2. Set exact inventory quantities (upsert — sets, doesn't add)
    store.execute(
        """INSERT INTO user_inventory (user_id, item_id, quantity)
           VALUES (?, 'potion_health_small', ?)
           ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = excluded.quantity""",
        (user_id, potion_count)
    )
    store.execute(
        """INSERT INTO user_inventory (user_id, item_id, quantity)
           VALUES (?, 'fifty_fifty', ?)
           ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = excluded.quantity""",
        (user_id, fifty_count)
    )

    return {"ok": True, "potion_health_small": potion_count, "fifty_fifty": fifty_count}


@app.get("/achievements")
async def get_achievements(request: Request):
    """Return all achievements with the user's unlock status and progress."""
    user = await get_optional_user(request)
    if not user:
        all_ach = store.get_achievements()
        return {"achievements": [dict(a) for a in all_ach], "unlocked": {}, "progress": {}, "guest_mode": True}

    user_id = str(user["user_id"])
    store.ensure_user(user_id)

    all_ach = store.get_achievements()

    rows = store.fetchall(
        "SELECT achievement_id, unlocked_at_utc FROM user_achievements WHERE user_id = ?",
        (user_id,)
    )
    unlocked = {r["achievement_id"]: r["unlocked_at_utc"] for r in rows}

    progress = store.get_progress(user_id)
    stat_map = {
        "total_quizzes_completed":   int(progress.get("total_quizzes_completed",   0) or 0),
        "streak_days":               int(progress.get("streak_days",               0) or 0),
        "total_bosses_defeated":     int(progress.get("total_bosses_defeated",      0) or 0),
        "current_level":             int(progress.get("current_level",             1) or 1),
        "best_quiz_accuracy":        int(progress.get("best_quiz_accuracy",         0) or 0),
        "nightmare_bosses_defeated": int(progress.get("nightmare_bosses_defeated",  0) or 0),
    }

    return {
        "achievements": [dict(a) for a in all_ach],
        "unlocked": unlocked,
        "progress": stat_map,
        "guest_mode": False,
    }


# ============================
# HEALTH
# ============================
@app.get("/health")
def health_check():
    return {"status": "healthy", "active_sessions": len(vector_stores), "auth_enabled": True, "history_enabled": True}





if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)