import os
import json
import sqlite3
import threading
from typing import Any, Optional
# FIX BUG 26: list[dict] and dict[str, Any] syntax requires Python 3.9+.
# Using quoted string annotations (PEP 563 style) for backward compatibility.
from services.progression.time_utils import utc_now_iso, utc_today

VALID_PROGRESS_FIELDS = frozenset({
    "total_xp", "current_level", "coins",
    "streak_days", "last_active_utc", "streak_freezes",
    "total_arena_rounds", "total_bosses_defeated", "total_quizzes_completed",
    "total_chat_questions", "total_chat_bundles", "total_notes_generated",
    "total_flashcards_studied",
    "best_quiz_accuracy", "nightmare_bosses_defeated",  # added
    "updated_at",
})


SCHEMA_SQL = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS user_progress (
  user_id TEXT PRIMARY KEY,
  total_xp INTEGER NOT NULL DEFAULT 0,
  current_level INTEGER NOT NULL DEFAULT 1,
  coins INTEGER NOT NULL DEFAULT 0,

  streak_days INTEGER NOT NULL DEFAULT 0,
  last_active_utc DATE,
  streak_freezes INTEGER NOT NULL DEFAULT 0,

  total_arena_rounds INTEGER NOT NULL DEFAULT 0,
  total_bosses_defeated INTEGER NOT NULL DEFAULT 0,
  total_quizzes_completed INTEGER NOT NULL DEFAULT 0,
  total_chat_questions INTEGER NOT NULL DEFAULT 0,
  total_chat_bundles INTEGER NOT NULL DEFAULT 0,
  total_notes_generated INTEGER NOT NULL DEFAULT 0,
  total_flashcards_studied INTEGER NOT NULL DEFAULT 0,
  best_quiz_accuracy INTEGER NOT NULL DEFAULT 0,
  nightmare_bosses_defeated INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_avatar (
  user_id TEXT PRIMARY KEY,
  equipped_json TEXT NOT NULL DEFAULT '{}',
  owned_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user_progress(user_id)
);

CREATE TABLE IF NOT EXISTS daily_action_counts (
  user_id TEXT NOT NULL,
  action_date_utc DATE NOT NULL,
  action_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_ts_utc TEXT,
  PRIMARY KEY(user_id, action_date_utc, action_type)
);

CREATE TABLE IF NOT EXISTS daily_quests (
  user_id TEXT NOT NULL,
  quest_date_utc DATE NOT NULL,
  quest_type TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  current_count INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL,
  reward_coins INTEGER NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, quest_date_utc, quest_type)
);

CREATE TABLE IF NOT EXISTS achievements (
  achievement_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  unlock_type TEXT NOT NULL,
  unlock_threshold INTEGER NOT NULL,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_coins INTEGER NOT NULL DEFAULT 0,
  reward_cosmetic_id TEXT,
  tier TEXT NOT NULL DEFAULT 'common'
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at_utc TEXT NOT NULL,
  PRIMARY KEY(user_id, achievement_id),
  FOREIGN KEY(user_id) REFERENCES user_progress(user_id),
  FOREIGN KEY(achievement_id) REFERENCES achievements(achievement_id)
);

CREATE TABLE IF NOT EXISTS user_buffs (
  user_id TEXT PRIMARY KEY,
  buffs_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_inventory (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(user_id, item_id)
);
"""

class SQLiteStore:
    """
    SQLite store with persistent thread-local connections.

    Previously every execute/fetchone/fetchall called sqlite3.connect() +
    conn.close() — paying file-open + WAL-handshake overhead on every query.
    Now each OS thread reuses one long-lived connection.  WAL mode means
    readers never block writers across threads.  A single write-lock serialises
    all mutations so we never hit SQLITE_BUSY on concurrent FastAPI threads.
    """

    def __init__(self, db_path: str = "data/gamification.db"):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._write_lock = threading.Lock()
        self._local = threading.local()  # per-thread connection storage

    def _conn(self) -> sqlite3.Connection:
        """Return (or lazily create) this thread's persistent connection."""
        if not getattr(self._local, "conn", None):
            conn = sqlite3.connect(self.db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            self._local.conn = conn
        return self._local.conn

    def init_db(self) -> None:
        with self._write_lock:
            conn = self._conn()
            conn.executescript(SCHEMA_SQL)
            migrations = [
                "ALTER TABLE user_progress ADD COLUMN total_flashcards_studied INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE user_progress ADD COLUMN best_quiz_accuracy INTEGER NOT NULL DEFAULT 0",
                "ALTER TABLE user_progress ADD COLUMN nightmare_bosses_defeated INTEGER NOT NULL DEFAULT 0",
            ]
            for sql in migrations:
                try:
                    conn.execute(sql)
                except Exception:
                    pass  # column already exists
            conn.commit()

    def execute(self, sql: str, params: tuple = ()) -> None:
        with self._write_lock:
            conn = self._conn()
            conn.execute(sql, params)
            conn.commit()

    def fetchone(self, sql: str, params: tuple = ()) -> Optional[dict]:
        # Reads don't need the write lock — WAL allows concurrent readers
        cur = self._conn().execute(sql, params)
        row = cur.fetchone()
        return dict(row) if row else None

    def fetchall(self, sql: str, params: tuple = ()) -> "list[dict]":
        cur = self._conn().execute(sql, params)
        return [dict(r) for r in cur.fetchall()]

    # --------------------------
    # User bootstrap
    # --------------------------
    # Process-level cache: once we've ensured a user exists we never need to
    # repeat the two INSERT OR IGNORE writes on every subsequent request.
    _ensured_users: set = set()

    def ensure_user(self, user_id: str) -> None:
        if user_id in SQLiteStore._ensured_users:
            return  # already bootstrapped this process lifetime — skip DB
        now = utc_now_iso()
        # progress
        self.execute("""
            INSERT OR IGNORE INTO user_progress (user_id, created_at, updated_at)
            VALUES (?, ?, ?)
        """, (user_id, now, now))

        # avatar
        self.execute("""
            INSERT OR IGNORE INTO user_avatar (user_id, created_at, updated_at)
            VALUES (?, ?, ?)
        """, (user_id, now, now))

        SQLiteStore._ensured_users.add(user_id)

    def get_progress(self, user_id: str) -> dict:
        self.ensure_user(user_id)
        row = self.fetchone("SELECT * FROM user_progress WHERE user_id = ?", (user_id,))
        return row or {}

    def update_progress_fields(self, user_id: str, fields: "dict[str, Any]") -> None:
        if not fields:
            return
        unknown = set(fields) - VALID_PROGRESS_FIELDS - {"updated_at"}
        if unknown:
            raise ValueError(f"update_progress_fields: unknown fields {unknown}")
        self.ensure_user(user_id)
        fields = dict(fields)
        fields["updated_at"] = utc_now_iso()

        keys = list(fields.keys())
        sets = ", ".join([f"{k} = ?" for k in keys])
        params = tuple(fields[k] for k in keys) + (user_id,)
        self.execute(f"UPDATE user_progress SET {sets} WHERE user_id = ?", params)

    def increment_progress(self, user_id: str, field: str, amount: int = 1) -> None:
        if field not in VALID_PROGRESS_FIELDS:
            raise ValueError(f"increment_progress: unknown field {field!r}")
        self.ensure_user(user_id)
        self.execute(
            f"UPDATE user_progress SET {field} = {field} + ?, updated_at = ? WHERE user_id = ?",
            (amount, utc_now_iso(), user_id)
        )

    # --------------------------
    # Avatar
    # --------------------------
    def get_avatar(self, user_id: str) -> dict:
        self.ensure_user(user_id)
        row = self.fetchone("SELECT * FROM user_avatar WHERE user_id = ?", (user_id,))
        if not row:
            return {"equipped_json": "{}", "owned_json": "[]"}
        return row

    def set_avatar(self, user_id: str, equipped: dict, owned: "list[str]") -> None:
        self.ensure_user(user_id)
        self.execute("""
            UPDATE user_avatar
            SET equipped_json = ?, owned_json = ?, updated_at = ?
            WHERE user_id = ?
        """, (json.dumps(equipped), json.dumps(owned), utc_now_iso(), user_id))

    # --------------------------
    # Daily action counts (caps/cooldowns)
    # --------------------------
    def get_daily_action(self, user_id: str, action_date_utc: str, action_type: str) -> dict:
        row = self.fetchone("""
            SELECT * FROM daily_action_counts
            WHERE user_id = ? AND action_date_utc = ? AND action_type = ?
        """, (user_id, action_date_utc, action_type))
        return row or {"count": 0, "last_ts_utc": None}

    def inc_daily_action(self, user_id: str, action_date_utc: str, action_type: str, amount: int = 1) -> None:
        now = utc_now_iso()
        self.execute("""
            INSERT INTO daily_action_counts (user_id, action_date_utc, action_type, count, last_ts_utc)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, action_date_utc, action_type)
            DO UPDATE SET count = count + excluded.count, last_ts_utc = excluded.last_ts_utc
        """, (user_id, action_date_utc, action_type, amount, now))

    # --------------------------
    # Daily quests
    # --------------------------
    def get_daily_quests(self, user_id: str, quest_date_utc: str) -> "list[dict]":
        return self.fetchall("""
            SELECT * FROM daily_quests
            WHERE user_id = ? AND quest_date_utc = ?
            ORDER BY quest_type
        """, (user_id, quest_date_utc))

    def insert_daily_quests(self, quests: "list[dict]") -> None:
        # quests items contain user_id, quest_date_utc, quest_type...
        with self._write_lock:
            conn = self._conn()
            conn.executemany("""
                    INSERT OR IGNORE INTO daily_quests
                    (user_id, quest_date_utc, quest_type, target_count, current_count, reward_xp, reward_coins, completed, claimed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    (
                        q["user_id"], q["quest_date_utc"], q["quest_type"],
                        q["target_count"], q.get("current_count", 0),
                        q["reward_xp"], q["reward_coins"],
                        q.get("completed", 0), q.get("claimed", 0)
                    )
                    for q in quests
                ])
            conn.commit()

    def update_quest(self, user_id: str, quest_date_utc: str, quest_type: str, fields: "dict[str, Any]") -> None:
        if not fields:
            return
        keys = list(fields.keys())
        sets = ", ".join([f"{k} = ?" for k in keys])
        params = tuple(fields[k] for k in keys) + (user_id, quest_date_utc, quest_type)
        self.execute(f"""
            UPDATE daily_quests SET {sets}
            WHERE user_id = ? AND quest_date_utc = ? AND quest_type = ?
        """, params)

    # --------------------------
    # Achievements
    # --------------------------
    def seed_achievements(self, ach_rows: "list[dict]") -> None:
        with self._write_lock:
            conn = self._conn()
            conn.executemany("""
                    INSERT OR IGNORE INTO achievements
                    (achievement_id, name, description, unlock_type, unlock_threshold, reward_xp, reward_coins, reward_cosmetic_id, tier)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    (
                        a["id"], a["name"], a["description"],
                        a["unlock_type"], a["threshold"],
                        a.get("reward_xp", 0), a.get("reward_coins", 0),
                        a.get("reward_cosmetic_id"), a.get("tier", "common")
                    )
                    for a in ach_rows
                ])
            conn.commit()

    def get_achievements(self) -> "list[dict]":
        return self.fetchall("SELECT * FROM achievements", ())

    def is_achievement_unlocked(self, user_id: str, achievement_id: str) -> bool:
        row = self.fetchone("""
            SELECT 1 FROM user_achievements
            WHERE user_id = ? AND achievement_id = ?
        """, (user_id, achievement_id))
        return row is not None


    def get_unlocked_achievement_ids(self, user_id: str) -> "set[str]":
        """Return set of all achievement IDs already unlocked by this user — single query."""
        rows = self.fetchall(
            "SELECT achievement_id FROM user_achievements WHERE user_id = ?",
            (user_id,)
        )
        return {r["achievement_id"] for r in rows}

    def unlock_achievement(self, user_id: str, achievement_id: str) -> None:
        self.execute("""
            INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at_utc)
            VALUES (?, ?, ?)
        """, (user_id, achievement_id, utc_now_iso()))

    # --------------------------
    # Consumable inventory
    # --------------------------
    def get_inventory(self, user_id: str) -> "list[dict]":
        return self.fetchall(
            "SELECT item_id, quantity FROM user_inventory WHERE user_id = ? AND quantity > 0",
            (user_id,)
        )

    def add_inventory_item(self, user_id: str, item_id: str, quantity: int = 1) -> None:
        self.execute("""
            INSERT INTO user_inventory (user_id, item_id, quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity
        """, (user_id, item_id, quantity))

    def consume_inventory_item(self, user_id: str, item_id: str) -> bool:
        """Decrement quantity by 1. Returns True if successful, False if not owned."""
        row = self.fetchone(
            "SELECT quantity FROM user_inventory WHERE user_id = ? AND item_id = ?",
            (user_id, item_id)
        )
        if not row or int(row["quantity"]) < 1:
            return False
        self.execute(
            "UPDATE user_inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_id = ?",
            (user_id, item_id)
        )
        return True