"""All SQL for the `documents` table. Connections come from database.db.Database (thread-local,
configured by database.connection.connect), so every worker thread gets its own."""
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

from database.db import Database

IN_FLIGHT = ("queued", "reading", "indexing")
TERMINAL = ("ready", "failed", "needs_reindex")


def utc_now() -> str:
    """Sortable UTC timestamp (all values share one format, so string comparison == time comparison)."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def utc_ago(hours: float = 0, days: float = 0) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours, days=days)).isoformat(timespec="milliseconds")


_PUBLIC = ("id, user_id, filename, file_hash, status, error, chunks, embedding_model, "
           "index_path, created_at, last_used_at")


def _marks(values: Iterable) -> str:
    return ",".join("?" for _ in values)


class DocumentRepository:
    def __init__(self, db: Database):
        self.db = db

    # ── reads ────────────────────────────────────────────────────────────────
    def get(self, doc_id: str) -> Optional[Dict]:
        rows = self.db.query(f"SELECT {_PUBLIC} FROM documents WHERE id = ?", [doc_id])
        return rows[0] if rows else None

    def list_for_user(self, user_id: int) -> List[Dict]:
        return self.db.query(
            f"SELECT {_PUBLIC} FROM documents WHERE user_id = ? ORDER BY last_used_at DESC, id", [user_id])

    def find_ready_by_hash(self, user_id: int, file_hash: str, embedding_model: str, exclude_id: str = "") -> List[Dict]:
        """This user's finished documents with the same file content (candidates to share an index)."""
        return self.db.query(
            f"SELECT {_PUBLIC} FROM documents WHERE user_id = ? AND file_hash = ? AND status = 'ready' "
            "AND embedding_model = ? AND index_path IS NOT NULL AND id != ? ORDER BY last_used_at DESC",
            [user_id, file_hash, embedding_model, exclude_id])

    def in_flight(self) -> List[Dict]:
        return self.db.query(
            f"SELECT {_PUBLIC} FROM documents WHERE status IN ({_marks(IN_FLIGHT)}) ORDER BY created_at", list(IN_FLIGHT))

    def index_refs(self, index_path: str, exclude_id: str = "") -> int:
        """How many OTHER documents still point at this index (it may only be deleted at zero)."""
        return self.db.query(
            "SELECT COUNT(*) AS n FROM documents WHERE index_path = ? AND id != ?", [index_path, exclude_id])[0]["n"]

    def count_for_user(self, user_id: int) -> int:
        return self.db.query("SELECT COUNT(*) AS n FROM documents WHERE user_id = ?", [user_id])[0]["n"]

    def count_all(self) -> int:
        return self.db.query("SELECT COUNT(*) AS n FROM documents")[0]["n"]

    def count_ready(self) -> int:
        return self.db.query("SELECT COUNT(*) AS n FROM documents WHERE status = 'ready'")[0]["n"]

    def oldest_removable(self, limit: int, user_id: Optional[int] = None, exclude_id: str = "") -> List[Dict]:
        """Least recently used documents that are not being processed right now."""
        sql = (f"SELECT {_PUBLIC} FROM documents WHERE status IN ({_marks(TERMINAL)}) AND id != ?")
        params: list = [*TERMINAL, exclude_id]
        if user_id is not None:
            sql += " AND user_id = ?"
            params.append(user_id)
        return self.db.query(sql + " ORDER BY last_used_at ASC LIMIT ?", [*params, limit])

    def idle_since(self, cutoff: str) -> List[Dict]:
        return self.db.query(
            f"SELECT {_PUBLIC} FROM documents WHERE status IN ({_marks(TERMINAL)}) AND last_used_at < ?",
            [*TERMINAL, cutoff])

    # ── writes ───────────────────────────────────────────────────────────────
    def upsert_queued(self, doc_id: str, user_id: int, filename: str, file_hash: str) -> None:
        """New upload (or a replacement for an existing id). index_path is kept until the new build
        replaces it, so the previous index can be cleaned up afterwards."""
        now = utc_now()
        self.db.execute(
            """INSERT INTO documents (id, user_id, filename, file_hash, status, created_at, last_used_at)
               VALUES (?, ?, ?, ?, 'queued', ?, ?)
               ON CONFLICT(id) DO UPDATE SET filename = excluded.filename, file_hash = excluded.file_hash,
                   status = 'queued', error = NULL, chunks = NULL, embedding_model = NULL,
                   created_at = excluded.created_at, last_used_at = excluded.last_used_at""",
            (doc_id, user_id, filename, file_hash, now, now))

    def upsert_ready_copy(self, doc_id: str, user_id: int, filename: str, file_hash: str,
                          chunks: Optional[int], embedding_model: str, index_path: str,
                          created_at: Optional[str] = None) -> None:
        """A finished document that points at an existing index: the same file uploaded again by the same
        user (no re-embedding), or a document imported from the old on-disk layout."""
        now = utc_now()
        self.db.execute(
            """INSERT INTO documents (id, user_id, filename, file_hash, status, chunks, embedding_model,
                                      index_path, created_at, last_used_at)
               VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET filename = excluded.filename, file_hash = excluded.file_hash,
                   status = 'ready', error = NULL, chunks = excluded.chunks,
                   embedding_model = excluded.embedding_model, index_path = excluded.index_path,
                   created_at = excluded.created_at, last_used_at = excluded.last_used_at""",
            (doc_id, user_id, filename, file_hash, chunks, embedding_model, index_path, created_at or now, now))

    def transition(self, doc_id: str, file_hash: str, expected: str, new: str) -> bool:
        """Move queued->reading->indexing, but only if this is still the upload the job was started for."""
        cur = self.db.write_returning(
            "UPDATE documents SET status = ? WHERE id = ? AND file_hash = ? AND status = ? RETURNING id",
            [new, doc_id, file_hash, expected])
        return bool(cur)

    def mark_ready(self, doc_id: str, file_hash: str, chunks: int, embedding_model: str, index_path: str) -> bool:
        return bool(self.db.write_returning(
            "UPDATE documents SET status = 'ready', error = NULL, chunks = ?, embedding_model = ?, index_path = ?, "
            "last_used_at = ? WHERE id = ? AND file_hash = ? AND status = 'indexing' RETURNING id",
            [chunks, embedding_model, index_path, utc_now(), doc_id, file_hash]))

    def mark_failed(self, doc_id: str, file_hash: str, error: str) -> bool:
        return bool(self.db.write_returning(
            f"UPDATE documents SET status = 'failed', error = ? WHERE id = ? AND file_hash = ? "
            f"AND status IN ({_marks(IN_FLIGHT)}) RETURNING id", [error, doc_id, file_hash, *IN_FLIGHT]))

    def fail_ready(self, doc_id: str, error: str) -> None:
        """A document marked ready whose index turned out to be unreadable."""
        self.db.execute("UPDATE documents SET status = 'failed', error = ? WHERE id = ? AND status = 'ready'", (error, doc_id))

    def mark_needs_reindex(self, doc_id: str) -> None:
        self.db.execute("UPDATE documents SET status = 'needs_reindex' WHERE id = ? AND status = 'ready'", (doc_id,))

    def mark_needs_reindex_where_model_differs(self, embedding_model: str) -> int:
        return len(self.db.write_returning(
            "UPDATE documents SET status = 'needs_reindex' WHERE status = 'ready' "
            "AND (embedding_model IS NULL OR embedding_model != ?) RETURNING id", [embedding_model]))

    def requeue(self, doc_id: str) -> None:
        self.db.execute(f"UPDATE documents SET status = 'queued' WHERE id = ? AND status IN ({_marks(IN_FLIGHT)})",
                        (doc_id, *IN_FLIGHT))

    def touch(self, doc_id: str) -> None:
        self.db.execute("UPDATE documents SET last_used_at = ? WHERE id = ?", (utc_now(), doc_id))

    def delete(self, doc_id: str) -> None:
        self.db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
