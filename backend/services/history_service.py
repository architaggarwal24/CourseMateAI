import logging

logger = logging.getLogger(__name__)

import json
from datetime import datetime
from typing import List, Dict

# Modes that are deliberately excluded from the history log.
# Arena activity is high-volume noise (boss spawns, per-question events) and
# not useful in the History view, so we skip it entirely.
_EXCLUDED_MODES = frozenset({"arena"})


class HistoryService:
    def __init__(self, db):
        self.db = db

    def log_activity(
            self,
            user_id: int,
            session_id: str,
            mode: str,
            action_type: str,
            content: Dict
    ):
        """Log user activity. Arena mode is silently skipped."""
        if mode in _EXCLUDED_MODES:
            return
        self.db.execute(
            """
            INSERT INTO activity_log 
            (user_id, session_id, mode, action_type, content)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, session_id, mode, action_type, json.dumps(content))
        )

    def prune_old_logs(self, days_to_keep: int = 90, max_rows_per_user: int = 500) -> int:
        """
        Delete activity_log rows older than days_to_keep OR beyond max_rows_per_user per user.
        Called periodically to prevent unbounded table growth.
        Returns number of rows deleted.
        """
        deleted = 0
        result = self.db.execute(
            "DELETE FROM activity_log WHERE created_at < datetime('now', ?)",
            (f"-{days_to_keep} days",)
        )

        users = self.db.query("SELECT DISTINCT user_id FROM activity_log", [])
        for row in users:
            uid = row["user_id"]
            self.db.execute(
                """
                DELETE FROM activity_log
                WHERE user_id = ?
                  AND id NOT IN (
                      SELECT id FROM activity_log
                      WHERE user_id = ?
                      ORDER BY created_at DESC
                      LIMIT ?
                  )
                """,
                (uid, uid, max_rows_per_user)
            )
        return deleted

    def get_user_history(
            self,
            user_id: int,
            mode: str = None,
            limit: int = 100
    ) -> List[Dict]:
        """Get user's activity history. Arena is never returned."""
        query = """
            SELECT * FROM activity_log
            WHERE user_id = ?
              AND mode NOT IN ('arena')
        """
        params = [user_id]

        if mode and mode not in _EXCLUDED_MODES:
            query += " AND mode = ?"
            params.append(mode)

        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        rows = self.db.query(query, params)

        return [
            {
                **row,
                'content': json.loads(row['content'])
            }
            for row in rows
        ]

    def get_session_history(self, session_id: str) -> List[Dict]:
        """Get all non-arena activity for a specific session."""
        rows = self.db.query(
            """
            SELECT * FROM activity_log
            WHERE session_id = ?
              AND mode NOT IN ('arena')
            ORDER BY created_at ASC
            """,
            [session_id]
        )

        return [
            {
                **row,
                'content': json.loads(row['content'])
            }
            for row in rows
        ]