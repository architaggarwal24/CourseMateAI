import os
import json
import sqlite3
import threading
from typing import Any, Optional
# FIX BUG 26: list[dict] and dict[str, Any] syntax requires Python 3.9+.
# Using quoted string annotations (PEP 563 style) for backward compatibility.
from contextlib import contextmanager
from database.connection import connect
from services.progression.time_utils import local_today, normalize_timezone, utc_now_iso
from services.progression.progression import level_from_total_xp

# Plain counters / state that may be written directly. total_xp, coins and current_level are NOT here:
# they are a cache of the reward_events ledger and change only through SQLiteStore.record_reward_event().
VALID_PROGRESS_FIELDS = frozenset({
    "streak_days", "last_active_utc", "streak_freezes",
    "total_arena_rounds", "total_bosses_defeated", "total_quizzes_completed",
    "total_chat_questions", "total_chat_bundles", "total_notes_generated",
    "total_flashcards_studied",
    "best_quiz_accuracy", "nightmare_bosses_defeated",  # added
    "updated_at",
})


class SQLiteStore:
    """
    SQLite store with persistent thread-local connections.

    Previously every execute/fetchone/fetchall opened and closed its own connection —
    paying file-open + WAL-handshake overhead on every query.
    Now each OS thread reuses one long-lived connection.  WAL mode means
    readers never block writers across threads.  A single write-lock serialises
    all mutations so we never hit SQLITE_BUSY on concurrent FastAPI threads.
    """

    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        # RLock: service code wraps multi-step read-modify-write sequences in
        # `with store.atomic():` and those sequences call execute() internally.
        self._write_lock = threading.RLock()
        self._local = threading.local()  # per-thread connection storage

    def _conn(self) -> sqlite3.Connection:
        """Return (or lazily create) this thread's persistent connection."""
        if not getattr(self._local, "conn", None):
            self._local.conn = connect(self.db_path)   # foreign keys ON, WAL, busy_timeout
        return self._local.conn

    def _commit(self, conn: sqlite3.Connection) -> None:
        """Commit - unless this thread is inside transaction(), which commits once at the end."""
        if getattr(self._local, "tx_depth", 0) == 0:
            conn.commit()

    @contextmanager
    def transaction(self):
        """One real database transaction: every write inside commits together, or none does.

        Takes the process-wide write lock AND `BEGIN IMMEDIATE`, so it also serialises against other
        server processes using the same file. Re-entrant: a nested call joins the outer transaction.
        An exception rolls everything back. Never hold this while calling an LLM.
        """
        with self._write_lock:
            conn = self._conn()
            depth = getattr(self._local, "tx_depth", 0)
            if depth == 0:
                conn.execute("BEGIN IMMEDIATE")
            self._local.tx_depth = depth + 1
            try:
                yield self
            except BaseException:
                self._local.tx_depth = depth
                if depth == 0:
                    conn.rollback()
                raise
            else:
                self._local.tx_depth = depth
                if depth == 0:
                    conn.commit()

    @contextmanager
    def atomic(self):
        """Serialise a multi-step read-modify-write against every other writer.

        Without this, two concurrent requests could both read coins=100, both pass
        an affordability check, and both "spend" it; or both pass a daily-cap check
        before either incremented the counter. Never hold this while calling an LLM.
        (Protects a single server process; for multiple workers move to Postgres or
        rely on the conditional single-statement updates below.)
        """
        with self._write_lock:
            yield self

    def execute(self, sql: str, params: tuple = ()) -> int:
        """Run a write. Returns the number of rows changed (0 means a guarded
        UPDATE/INSERT did not apply – use that for compare-and-set logic)."""
        with self._write_lock:
            conn = self._conn()
            try:
                cur = conn.execute(sql, params)
            except BaseException:
                if getattr(self._local, "tx_depth", 0) == 0:
                    conn.rollback()      # a failed write must not leave a transaction (and its lock) open
                raise
            self._commit(conn)
            return cur.rowcount

    @staticmethod
    def _as_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        # user_id is INTEGER in the database, but everything above this layer (services, API
        # responses, caches) identifies users by string - keep that interface unchanged.
        if "user_id" in d and d["user_id"] is not None:
            d["user_id"] = str(d["user_id"])
        return d

    def fetchone(self, sql: str, params: tuple = ()) -> Optional[dict]:
        # Reads don't need the write lock — WAL allows concurrent readers
        cur = self._conn().execute(sql, params)
        row = cur.fetchone()
        return self._as_dict(row) if row else None

    def fetchall(self, sql: str, params: tuple = ()) -> "list[dict]":
        cur = self._conn().execute(sql, params)
        return [self._as_dict(r) for r in cur.fetchall()]

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

    # --------------------------
    # Per-user local day
    # --------------------------
    def get_user_timezone(self, user_id: str) -> str:
        """The user's IANA time zone ("UTC" when unknown)."""
        row = self.fetchone("SELECT timezone FROM users WHERE id = ?", (user_id,))
        return normalize_timezone((row or {}).get("timezone"))

    def user_today(self, user_id: str):
        """Today's date for this user: the calendar date in THEIR time zone. This is the "day" for
        streaks, daily caps, daily quests and the leaderboard."""
        return local_today(self.get_user_timezone(user_id))

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

    def reserve_daily_action(self, user_id: str, action_date_utc: str,
                             action_type: str, cap: int) -> bool:
        """Atomically take one slot under a daily cap. True = slot taken, False = cap reached.

        Check-then-increment (old behaviour) let N parallel requests all pass the
        check before any of them incremented, bypassing the cap entirely.
        """
        now = utc_now_iso()
        changed = self.execute("""
            INSERT INTO daily_action_counts (user_id, action_date_utc, action_type, count, last_ts_utc)
            VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(user_id, action_date_utc, action_type)
            DO UPDATE SET count = count + 1, last_ts_utc = excluded.last_ts_utc
            WHERE count < ?
        """, (user_id, action_date_utc, action_type, now, cap))
        return changed == 1

    # --------------------------
    # Reward ledger (append-only)
    # --------------------------
    def record_reward_event(self, user_id: str, kind: str, xp: int = 0, coins: int = 0,
                            source_id: Optional[str] = None, *, idempotency_key: str) -> dict:
        """Append one event to reward_events and apply it to the cached totals - ONE transaction.

        This is the only way XP / coins / level change. `idempotency_key` is UNIQUE: recording the same
        key again changes nothing and returns applied=False, reason="duplicate" - that is what makes a
        double claim impossible, even across processes. An event that would take XP or coins below zero
        (a purchase the user cannot afford) is refused: applied=False, reason="insufficient_funds".

        Returns {"applied", "reason" (when not applied), "total_xp", "coins", "level"}.
        """
        xp, coins = int(xp), int(coins)
        self.ensure_user(user_id)
        now = utc_now_iso()
        with self.transaction():
            conn = self._conn()
            conn.execute("SAVEPOINT reward_event")
            reason = None
            cur = conn.execute(
                "INSERT INTO reward_events (user_id, kind, xp, coins, source_id, idempotency_key, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING",
                (user_id, kind, xp, coins, source_id, idempotency_key, now))
            if cur.rowcount != 1:
                reason = "duplicate"
            else:
                cur = conn.execute(
                    "UPDATE user_progress SET total_xp = total_xp + ?, coins = coins + ?, updated_at = ? "
                    "WHERE user_id = ? AND total_xp + ? >= 0 AND coins + ? >= 0",
                    (xp, coins, now, user_id, xp, coins))
                if cur.rowcount != 1:
                    reason = "insufficient_funds"
            if reason:
                conn.execute("ROLLBACK TO reward_event")
            conn.execute("RELEASE reward_event")

            row = conn.execute(
                "SELECT total_xp, coins, current_level FROM user_progress WHERE user_id = ?", (user_id,)
            ).fetchone()
            total_xp, balance, level = int(row["total_xp"]), int(row["coins"]), int(row["current_level"])
            if not reason:
                new_level = level_from_total_xp(total_xp)
                if new_level != level:
                    conn.execute("UPDATE user_progress SET current_level = ? WHERE user_id = ?", (new_level, user_id))
                    level = new_level
        out = {"applied": reason is None, "total_xp": total_xp, "coins": balance, "level": level}
        if reason:
            out["reason"] = reason
        return out

    def ledger_totals(self, user_id: str) -> dict:
        """XP / coins / level derived purely from reward_events (what the cached totals must equal)."""
        row = self.fetchone(
            "SELECT COALESCE(SUM(xp), 0) AS xp, COALESCE(SUM(coins), 0) AS coins, COUNT(*) AS events "
            "FROM reward_events WHERE user_id = ?", (user_id,))
        xp = int(row["xp"])
        return {"total_xp": xp, "coins": int(row["coins"]), "level": level_from_total_xp(xp),
                "events": int(row["events"])}

    def count_reward_events(self, user_id: str, kind: str, source_id: Optional[str] = None) -> int:
        if source_id is None:
            row = self.fetchone("SELECT COUNT(*) AS n FROM reward_events WHERE user_id = ? AND kind = ?", (user_id, kind))
        else:
            row = self.fetchone(
                "SELECT COUNT(*) AS n FROM reward_events WHERE user_id = ? AND kind = ? AND source_id = ?",
                (user_id, kind, source_id))
        return int(row["n"])

    # --------------------------
    # Avatar (owned / equipped) – safe read-modify-write
    # --------------------------
    def modify_avatar(self, user_id: str, mutator) -> tuple:
        """Load owned/equipped, let `mutator(equipped, owned)` change them in place,
        then persist – all under the write lock so concurrent changes (e.g. a
        purchase and the /hud free-item grant) can't overwrite each other."""
        self.ensure_user(user_id)
        with self._write_lock:
            avatar = self.get_avatar(user_id)
            equipped = json.loads(avatar.get("equipped_json") or "{}")
            owned = json.loads(avatar.get("owned_json") or "[]")
            mutator(equipped, owned)
            self.set_avatar(user_id, equipped=equipped, owned=owned)
            return equipped, owned

    # --------------------------
    # Account deletion (rows go via ON DELETE CASCADE)
    # --------------------------
    def forget_user(self, user_id: str) -> None:
        """Drop the process-level "already bootstrapped" cache entry for a deleted user.

        The rows themselves are removed by ON DELETE CASCADE when the users row is deleted
        (Database.delete_user_data); without this, ensure_user() would think they still exist."""
        SQLiteStore._ensured_users.discard(user_id)

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
            self._commit(conn)

    def increment_quest(self, user_id: str, quest_date_utc: str, quest_type: str, amount: int = 1) -> None:
        """Atomic increment-and-complete. Skips claimed/completed quests."""
        self.execute("""
            UPDATE daily_quests
            SET current_count = current_count + ?,
                completed = CASE WHEN current_count + ? >= target_count THEN 1 ELSE 0 END
            WHERE user_id = ? AND quest_date_utc = ? AND quest_type = ?
              AND claimed = 0 AND completed = 0
        """, (amount, amount, user_id, quest_date_utc, quest_type))

    def claim_quest_row(self, user_id: str, quest_date_utc: str, quest_type: str) -> bool:
        """Mark a completed quest as claimed. True only for the ONE caller that wins."""
        return self.execute("""
            UPDATE daily_quests SET claimed = 1
            WHERE user_id = ? AND quest_date_utc = ? AND quest_type = ?
              AND completed = 1 AND claimed = 0
        """, (user_id, quest_date_utc, quest_type)) == 1

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
    def seed_achievements(self, rows: "list[dict]") -> None:
        """Insert-or-update the achievement catalogue from rows keyed by the table's own column names
        (Achievement.as_row() in content.py). The content file is the source of truth: editing a reward
        there updates the existing row at the next start; users' unlocks (user_achievements) are untouched."""
        if not rows:
            return
        columns = list(rows[0])
        updates = ", ".join(f"{c} = excluded.{c}" for c in columns if c != "achievement_id")
        sql = (f"INSERT INTO achievements ({', '.join(columns)}) VALUES ({', '.join('?' * len(columns))}) "
               f"ON CONFLICT(achievement_id) DO UPDATE SET {updates}")
        with self._write_lock:
            conn = self._conn()
            conn.executemany(sql, [tuple(r[c] for c in columns) for r in rows])
            self._commit(conn)

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

    def unlock_achievement(self, user_id: str, achievement_id: str) -> bool:
        """True only if this call newly unlocked it (so rewards are granted once)."""
        return self.execute("""
            INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at_utc)
            VALUES (?, ?, ?)
        """, (user_id, achievement_id, utc_now_iso())) == 1

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
        """Decrement quantity by 1 in a single guarded statement.
        Returns False if the user has none – so a potion can't be used twice by
        two parallel requests (old code: SELECT, then UPDATE)."""
        return self.execute(
            "UPDATE user_inventory SET quantity = quantity - 1 "
            "WHERE user_id = ? AND item_id = ? AND quantity >= 1",
            (user_id, item_id),
        ) == 1

    def get_inventory_quantity(self, user_id: str, item_id: str) -> int:
        row = self.fetchone(
            "SELECT quantity FROM user_inventory WHERE user_id = ? AND item_id = ?",
            (user_id, item_id),
        )
        return int(row["quantity"]) if row else 0
