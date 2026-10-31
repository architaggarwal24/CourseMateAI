"""
Database layer for CourseMateAI
Handles SQLite operations for users, sessions, and activity logging.

The schema is created and changed ONLY by migrations (backend/migrations, applied at startup by
database.migrate.upgrade) - this class never changes the schema.
"""

import sqlite3
import json
from typing import Optional, Dict, List, Any
from datetime import datetime, timezone
import threading

from database.connection import connect
from errors import FieldValueError
from utils.timezones import is_valid_timezone, normalize_timezone


class Database:
    """SQLite database wrapper with thread safety"""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.local = threading.local()
        self._ensured_users: set = set()

    def _get_connection(self):
        """Get thread-local database connection"""
        if not hasattr(self.local, 'conn'):
            self.local.conn = connect(self.db_path)   # foreign keys ON, WAL, busy_timeout
        return self.local.conn

    def create_user(self, email: str, password_hash: bytes, username: str, full_name: str,
                    timezone: Optional[str] = None) -> int:
        """Create a new user and return user_id"""
        conn = self._get_connection()
        cursor = conn.cursor()

        # Usernames are unique case-insensitively ("Alice" vs "alice" would
        # otherwise be two accounts, which enables impersonation on leaderboards).
        if self.get_user_by_username(username):
            raise FieldValueError(f"Username {username} is already taken", "username")

        try:
            cursor.execute(
                """INSERT INTO users (email, username, full_name, password_hash, timezone)
                   VALUES (?, ?, ?, ?, ?)""",
                (email, username, full_name, password_hash.decode('utf-8'), normalize_timezone(timezone))
            )
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError as e:
            conn.rollback()      # a failed INSERT must not leave its transaction (and write lock) open
            error_msg = str(e).lower()
            if 'email' in error_msg:
                raise FieldValueError(f"User with email {email} already exists", "email")
            elif 'username' in error_msg:
                raise FieldValueError(f"Username {username} is already taken", "username")
            else:
                raise ValueError("User creation failed - duplicate data")

    def get_user_by_email(self, email: str) -> Optional[Dict]:
        """Get user by email"""
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        )

        row = cursor.fetchone()
        if row:
            return dict(row)
        return None

    def get_user_by_username(self, username: str) -> Optional[Dict]:
        """Get user by username"""
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT * FROM users WHERE username = ? COLLATE NOCASE",
            (username,)
        )

        row = cursor.fetchone()
        if row:
            return dict(row)
        return None

    def get_user_by_id(self, user_id: int) -> Optional[Dict]:
        """Get user by ID"""
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,)
        )

        row = cursor.fetchone()
        if row:
            return dict(row)
        return None

    def update_last_login(self, user_id: int):
        """Update user's last login timestamp"""
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(
            "UPDATE users SET last_login = ? WHERE id = ?",
            # ISO string: sqlite3's default datetime adapter is deprecated in Python 3.12.
            (datetime.now(timezone.utc).isoformat(), user_id)
        )
        conn.commit()

    def set_timezone(self, user_id: int, timezone: Optional[str]) -> None:
        """Remember the user's IANA time zone. An unknown / missing name leaves the stored one alone."""
        if not is_valid_timezone(timezone):
            return
        conn = self._get_connection()
        conn.execute("UPDATE users SET timezone = ? WHERE id = ? AND timezone <> ?", (timezone, user_id, timezone))
        conn.commit()

    def execute(self, query: str, params: tuple = ()):
        """Execute a query (INSERT, UPDATE, DELETE)"""
        conn = self._get_connection()
        cursor = conn.cursor()

        cursor.execute(query, params)
        conn.commit()
        return cursor.lastrowid

    def query(self, query: str, params: List = None) -> List[Dict]:
        """Execute a SELECT query and return results as list of dicts"""
        conn = self._get_connection()
        cursor = conn.cursor()

        if params is None:
            params = []

        cursor.execute(query, params)
        rows = cursor.fetchall()

        return [dict(row) for row in rows]

    def write_returning(self, query: str, params: List = None) -> List[Dict]:
        """Run an INSERT/UPDATE/DELETE ... RETURNING statement, commit, and return the affected rows.
        An empty list means "no row matched" - used for compare-and-set updates."""
        conn = self._get_connection()
        try:
            rows = conn.execute(query, params or []).fetchall()
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return [dict(r) for r in rows]

    def ensure_user(self, user_id: int):
        """Ensure user exists (for progression system compatibility)"""
        user = self.get_user_by_id(user_id)
        if not user:
            raise ValueError(f"User {user_id} does not exist")

    # FIX BUG 9: Removed stub get_progress / get_avatar methods.
    # They returned empty dicts and were never called — the real implementations
    # live on SQLiteStore (progression.db). Keeping them here was confusing.

    def save_api_key(self, user_id: int, encrypted_key: str, provider: str, model: str = None,
                     base_url: str = None) -> None:
        """Store encrypted API key, provider, model and (optional) base URL for a user"""
        conn = self._get_connection()
        conn.execute(
            "UPDATE users SET api_key_encrypted = ?, llm_provider = ?, llm_model = ?, llm_base_url = ? WHERE id = ?",
            (encrypted_key, provider, model, base_url, user_id)
        )
        conn.commit()

    def get_api_key_data(self, user_id: int) -> Optional[Dict]:
        """Retrieve encrypted API key and provider for a user"""
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT api_key_encrypted, llm_provider, llm_model, llm_base_url FROM users WHERE id = ?",
            (user_id,)
        )
        row = cursor.fetchone()
        if row:
            return {"api_key_encrypted": row[0], "llm_provider": row[1], "llm_model": row[2],
                    "llm_base_url": row[3]}
        return None

    def delete_user_data(self, user_id: int) -> None:
        """Delete a user. Foreign keys are ON and every per-user table (activity_log, sessions,
        progress, avatar, inventory, quests, achievements, leaderboard, ...) is declared
        ON DELETE CASCADE, so this one statement removes everything that belongs to them."""
        conn = self._get_connection()
        try:
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def close(self):
        """Close database connection"""
        if hasattr(self.local, 'conn'):
            self.local.conn.close()
            del self.local.conn