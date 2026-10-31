-- 0002: durable documents.
--
-- One row per uploaded PDF; the row id IS the session_id the study endpoints take. The table is the
-- source of truth (ownership, status, expiry, caps); the in-memory vector_stores dict is only a cache
-- of indexes that have been loaded from disk.
--
--   queued -> reading (extract text) -> indexing (chunk + embed + save) -> ready
--                                      \-> failed (error says why)
--   ready -> needs_reindex   when the configured embedding model no longer matches embedding_model
--
-- index_path is relative to the uploads folder. Several rows of the same user may share one index
-- (same file hash uploaded again = reuse, no re-embedding).

CREATE TABLE documents (
    id              TEXT PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    file_hash       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'reading', 'indexing', 'ready', 'failed', 'needs_reindex')),
    error           TEXT,
    chunks          INTEGER,
    embedding_model TEXT,
    index_path      TEXT,
    created_at      TEXT NOT NULL,
    last_used_at    TEXT NOT NULL
);
CREATE INDEX idx_documents_user      ON documents(user_id, last_used_at);
CREATE INDEX idx_documents_user_hash ON documents(user_id, file_hash);
CREATE INDEX idx_documents_status    ON documents(status);
CREATE INDEX idx_documents_index     ON documents(index_path);
