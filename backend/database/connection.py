"""The only place in the backend that opens database connections: SQLite (a file path), or - when the target
is a postgresql:// URL (DATABASE_URL) - PostgreSQL through the sqlite3-shaped adapter in database/pg.py.

Every connection gets the same settings, so they cannot drift apart:
  * foreign_keys = ON   - REFERENCES / ON DELETE CASCADE are enforced (off by default in SQLite)
  * journal_mode = WAL  - readers never block the writer
  * busy_timeout        - wait for a competing writer instead of failing with "database is locked"
  * synchronous = NORMAL - the usual (safe) pairing with WAL
"""
import sqlite3
from pathlib import Path
from typing import Union

BUSY_TIMEOUT_MS = 5000


def connect(path: Union[str, Path]) -> sqlite3.Connection:
    """Open a configured connection (rows are sqlite3.Row). Safe to share across threads' use via
    one connection per thread; callers keep their own thread-local connections."""
    from database import pg
    if pg.is_url(path):
        return pg.Connection(str(path))       # type: ignore[return-value]  (same surface as sqlite3.Connection)
    conn = sqlite3.connect(str(path), check_same_thread=False, timeout=BUSY_TIMEOUT_MS / 1000)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn
