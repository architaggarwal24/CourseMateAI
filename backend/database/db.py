"""
Database layer for CourseMateAI
Handles SQLite operations for users, sessions, and activity logging
Updated to support username and full_name
"""

import sqlite3
import json
from typing import Optional, Dict, List, Any
from datetime import datetime, timezone
import threading


class Database:
    """SQLite database wrapper with thread safety"""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.local = threading.local()
        self.init_db()
        self._ensured_users: set = set()

    def _get_connection(self):
        """Get thread-local database connection"""
        if not hasattr(self.local, 'conn'):
            self.local.conn = sqlite3.connect(self.db_path, check_same_thread=False)
            self.local.conn.row_factory = sqlite3.Row
            # Enable WAL mode for better concurrent access
            self.local.conn.execute("PRAGMA journal_mode=WAL")
            self.local.conn.execute("PRAGMA synchronous=NORMAL")
        return self.local.conn

    def init_db(self):
        """Initialize database tables"""
        conn = self._get_connection()
        cursor = conn.cursor()

        # Users table - Updated with username and full_name
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS users
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           email
                           TEXT
                           UNIQUE
                           NOT
                           NULL,
                           username
                           TEXT
                           UNIQUE
                           NOT
                           NULL,
                           full_name
                           TEXT
                           NOT
                           NULL,
                           password_hash
                           TEXT
                           NOT
                           NULL,
                           created_at
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           last_login
                           TIMESTAMP
                       )
                       """)

        # Check if we need to add new columns to existing table
        cursor.execute("PRAGMA table_info(users)")
        columns = [col[1] for col in cursor.fetchall()]

        if 'username' not in columns:
            try:
                cursor.execute("ALTER TABLE users ADD COLUMN username TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists

        if 'full_name' not in columns:
            try:
                cursor.execute("ALTER TABLE users ADD COLUMN full_name TEXT")
            except sqlite3.OperationalError:
                pass  # Column already exists

        # Create unique index on username if it doesn't exist
        try:
            cursor.execute("""
                           CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username
                               ON users(username)
                           """)
        except sqlite3.OperationalError:
            pass

        # Migrations: add api key columns to existing databases
        for col_sql in [
            "ALTER TABLE users ADD COLUMN api_key_encrypted TEXT",
            # FIX BUG 8: Do NOT use DEFAULT 'mistral' — that silently assigns
            # mistral to any row created before this column existed (migrated DBs),
            # even users who registered with OpenAI/Gemini/Claude.
            "ALTER TABLE users ADD COLUMN llm_provider TEXT",
            "ALTER TABLE users ADD COLUMN llm_model TEXT",
        ]:
            try:
                cursor.execute(col_sql)
            except sqlite3.OperationalError:
                pass  # column already exists

        # Sessions table (optional - for token revocation)
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS sessions
                       (
                           id
                           TEXT
                           PRIMARY
                           KEY,
                           user_id
                           INTEGER
                           NOT
                           NULL,
                           created_at
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           expires_at
                           TIMESTAMP
                           NOT
                           NULL,
                           FOREIGN
                           KEY
                       (
                           user_id
                       ) REFERENCES users
                       (
                           id
                       )
                           )
                       """)

        # Activity log table
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS activity_log
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           user_id
                           INTEGER
                           NOT
                           NULL,
                           session_id
                           TEXT
                           NOT
                           NULL,
                           mode
                           TEXT
                           NOT
                           NULL,
                           action_type
                           TEXT
                           NOT
                           NULL,
                           content
                           TEXT,
                           created_at
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           FOREIGN
                           KEY
                       (
                           user_id
                       ) REFERENCES users
                       (
                           id
                       )
                           )
                       """)

        # Create indexes for better performance
        cursor.execute("""
                       CREATE INDEX IF NOT EXISTS idx_activity_user
                           ON activity_log(user_id, created_at DESC)
                       """)

        cursor.execute("""
                       CREATE INDEX IF NOT EXISTS idx_activity_session
                           ON activity_log(session_id)
                       """)

        cursor.execute("""
                       CREATE INDEX IF NOT EXISTS idx_activity_mode
                           ON activity_log(mode, user_id)
                       """)

        conn.commit()

    def create_user(self, email: str, password_hash: bytes, username: str, full_name: str) -> int:
        """Create a new user and return user_id"""
        conn = self._get_connection()
        cursor = conn.cursor()

        try:
            cursor.execute(
                """INSERT INTO users (email, username, full_name, password_hash)
                   VALUES (?, ?, ?, ?)""",
                (email, username, full_name, password_hash.decode('utf-8'))
            )
            conn.commit()
            return cursor.lastrowid
        except sqlite3.IntegrityError as e:
            error_msg = str(e).lower()
            if 'email' in error_msg:
                raise ValueError(f"User with email {email} already exists")
            elif 'username' in error_msg:
                raise ValueError(f"Username {username} is already taken")
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
            "SELECT * FROM users WHERE username = ?",
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
            # FIX BUG 7: datetime.utcnow() is deprecated in Python 3.12+; use timezone-aware now().
        (datetime.now(timezone.utc), user_id)
        )
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

    def ensure_user(self, user_id: int):
        """Ensure user exists (for progression system compatibility)"""
        user = self.get_user_by_id(user_id)
        if not user:
            raise ValueError(f"User {user_id} does not exist")

    # FIX BUG 9: Removed stub get_progress / get_avatar methods.
    # They returned empty dicts and were never called — the real implementations
    # live on SQLiteStore (progression.db). Keeping them here was confusing.

    def save_api_key(self, user_id: int, encrypted_key: str, provider: str, model: str = None) -> None:
        """Store encrypted API key, provider and model for a user"""
        conn = self._get_connection()
        conn.execute(
            "UPDATE users SET api_key_encrypted = ?, llm_provider = ?, llm_model = ? WHERE id = ?",
            (encrypted_key, provider, model, user_id)
        )
        conn.commit()

    def get_api_key_data(self, user_id: int) -> Optional[Dict]:
        """Retrieve encrypted API key and provider for a user"""
        conn = self._get_connection()
        cursor = conn.execute(
            "SELECT api_key_encrypted, llm_provider, llm_model FROM users WHERE id = ?",
            (user_id,)
        )
        row = cursor.fetchone()
        if row:
            return {"api_key_encrypted": row[0], "llm_provider": row[1], "llm_model": row[2]}
        return None

    def close(self):
        """Close database connection"""
        if hasattr(self.local, 'conn'):
            self.local.conn.close()
            del self.local.conn