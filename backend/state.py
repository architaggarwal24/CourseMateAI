"""Process-wide shared objects: database handles, services, in-memory stores, rate limiter.

Everything here is created once at import time (exactly as main.py used to do) and is
imported by deps.py, app.py and the routers. This is a leaf module - it must not import
from app, deps or routers, otherwise the import graph becomes circular.
"""
import logging
import sys
import time as _time
from typing import Dict

from slowapi import Limiter

# Game content (shop, quests, achievements, level & reward tables) is validated FIRST, before anything that
# reads it is imported: a mistake in backend/content/*.json stops the server here with a readable message.
from game_content import ContentError, get_content
try:
    game_content = get_content()
except ContentError as _exc:
    print(f"\nERROR: {_exc}\n", file=sys.stderr)
    sys.exit(1)

from auth.auth_service import AuthService
from auth.middleware import AuthMiddleware
from config import settings
from database.db import Database
from database.documents import DocumentRepository
from database.migrate import MigrationError, upgrade as upgrade_database
from key_service import check_encryption_config
from middleware.client import rate_limit_key
from services.document_service import DocumentService
from services.generation_cache import GenerationCache
from services.history_service import HistoryService
from services.progression.achievement_service import AchievementService
from services.progression.buff_service import BuffService
from services.progression.db import SQLiteStore
from services.progression.quest_service import DailyQuestService
from services.progression.reward_service import RewardService
from services.progression.shop_service import ShopService
from services.arena_service import BattleService
from services.expedition_service import ExpeditionService
from services.mastery_service import MasteryService
from services.quiz_service import QuizService

logger = logging.getLogger(__name__)

# ── Database & auth ───────────────────────────────────────────────────────────
# One SQLite file for everything. The schema comes ONLY from backend/migrations (applied here,
# once, at startup); nothing below or in a request path creates or alters tables.
settings.data_dir.mkdir(parents=True, exist_ok=True)
try:
    upgrade_database(settings.database_path)
except MigrationError as _exc:       # e.g. un-merged legacy files, or a migration that was edited after use
    print(f"\nERROR: {_exc}\n", file=sys.stderr)
    sys.exit(1)
db = Database(str(settings.database_path))
check_encryption_config()   # fail fast if ENCRYPTION_KEY is missing/invalid
auth_service = AuthService(db, secret_key=settings.jwt_secret)
auth_middleware = AuthMiddleware(auth_service)
history_service = HistoryService(db)

store = SQLiteStore(str(settings.database_path))

# ── Progression services ──────────────────────────────────────────────────────
achievement_service = AchievementService(store)
achievement_service.seed(game_content.achievements.achievements)
buff_service = BuffService(store)
reward_service = RewardService(store, achievement_service, buff_service)
shop_service = ShopService(store, buff_service=buff_service)
quest_service = DailyQuestService(store)
# Concept mastery (what each user keeps missing on each document): written by arena, quiz and flashcard reviews.
mastery_service = MasteryService(store)
quiz_service = QuizService(store, reward_service, mastery=mastery_service)

# ── Uploaded documents ────────────────────────────────────────────────────────
# The `documents` table is the source of truth. `vector_stores` is only a cache of FAISS indexes that have
# been loaded from disk (filled lazily on first use, so a restart loses nothing).
vector_stores: Dict[str, Dict] = {}
documents = DocumentService(
    DocumentRepository(db), vector_stores,
    upload_dir=settings.upload_dir,
    embedding_model=settings.embedding_model,
    concurrency=settings.index_concurrency,
    max_per_user=settings.max_sessions_per_user,
    max_documents=settings.max_sessions,
    expiry_hours=settings.session_expiry_hours,
)

# Arena fights: the boss, hearts, questions, clock, rewards and leaderboard all live server-side.
battle_service = BattleService(store, reward_service, buff_service, documents, mastery=mastery_service)
# Expedition runs: a run's fights are ordinary battles whose end flows back into the run (same transaction).
expedition_service = ExpeditionService(store, reward_service, battle_service, mastery_service)
battle_service.on_run_battle_end = expedition_service.battle_ended


# In-memory cache: ArenaView stores pre-fetched boss+questions here,
# game.js reads them on init — same server, no cross-origin localStorage issue
# FIX BUG 53: Wrap in a simple TTL store to prevent unbounded growth.
class TTLCache:
    """Simple TTL-evicting dict. Entries expire after ttl_seconds."""
    def __init__(self, ttl_seconds: int = 3600, max_items: int = 500):
        self._data: Dict[str, tuple] = {}  # key → (value, expires_at)
        self._ttl = ttl_seconds
        self._max = max_items   # hard cap so a client can't grow server memory without limit

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
        while len(self._data) >= self._max and key not in self._data:
            oldest = min(self._data, key=lambda k: self._data[k][1])
            del self._data[oldest]
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


# Generated quizzes / flashcard sets / notes, reused for an identical request (see services/generation_cache.py)
generation_cache = GenerationCache(settings.generation_cache_ttl)

# ── Rate limiter (shared by every router's @limiter.limit; wired to the app in app.py) ──
# Keyed per signed-in user (anonymous routes: per client address behind trusted proxies) - see middleware/client.py.
limiter = Limiter(key_func=rate_limit_key)
