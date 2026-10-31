"""All SQL for the `sessions` table (see migrations/0003_revocable_sessions.sql)."""
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from database.db import Database


def _stamp(moment: datetime) -> str:
    """Sortable UTC timestamp: every value shares one format, so string comparison == time comparison."""
    return moment.astimezone(timezone.utc).isoformat(timespec="seconds")


class SessionRepository:
    def __init__(self, db: Database):
        self.db = db

    def create(self, session_id: str, user_id: int, lifetime: timedelta, keep_newest: int = 20) -> None:
        """Store a new session; the user's expired sessions go, and only the newest `keep_newest` stay
        (repeated logins can't grow the table without limit)."""
        now = datetime.now(timezone.utc)
        self.db.execute(
            "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (session_id, user_id, _stamp(now), _stamp(now + lifetime)))
        self.db.execute("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?", (user_id, _stamp(now)))
        self.db.execute(
            "DELETE FROM sessions WHERE user_id = ? AND id NOT IN "
            "(SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
            (user_id, user_id, keep_newest))

    def get_user(self, session_id: str) -> Optional[Dict]:
        """The account that owns a live (unexpired) session, or None."""
        rows = self.db.query(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?",
            [session_id, _stamp(datetime.now(timezone.utc))])
        return rows[0] if rows else None

    def delete(self, session_id: str) -> None:
        self.db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))

    def delete_for_user(self, user_id: int, except_id: Optional[str] = None) -> int:
        """Revoke all of a user's sessions (optionally keeping one). Returns how many were revoked."""
        rows = self.db.write_returning(
            "DELETE FROM sessions WHERE user_id = ? AND id != ? RETURNING id", [user_id, except_id or ""])
        return len(rows)

    def purge_expired(self) -> int:
        rows = self.db.write_returning(
            "DELETE FROM sessions WHERE expires_at <= ? RETURNING id", [_stamp(datetime.now(timezone.utc))])
        return len(rows)

    def count_for_user(self, user_id: int) -> int:
        return self.db.query("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", [user_id])[0]["n"]
