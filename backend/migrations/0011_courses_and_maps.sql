-- 0011: courses and concept maps (Phase 3, Stage 3B; docs/study-power.md section 5).
--
--   * courses / course_documents
--                  a course groups several of the user's documents. Its id is a uuid like a document's, so it
--                  can stand wherever a document id is used (chat, quiz, flashcards, notes, arena, exams): the
--                  documents service then searches every ready document of the course together. Removing a
--                  document from the account removes it from its courses (cascade). A document in a course is
--                  "pinned": it never expires for being idle.
--   * concept_maps one extraction per document CONTENT (file hash) and extractor version: the concepts, their
--                  relations and pages, written by one LLM pass and reused by every user / course that has the
--                  same PDF. `status` follows the background job (queued -> running -> ready | failed), `stage`
--                  is the progress line shown while it runs.
--   * The original PDFs are now kept (uploads/files/<file hash>.pdf) for the side-by-side viewer; that needs
--     no column - a document "has its PDF" when the file is there.

CREATE TABLE courses (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE INDEX idx_courses_user ON courses(user_id, updated_at);

CREATE TABLE course_documents (
    course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    added_at     TEXT NOT NULL,
    PRIMARY KEY (course_id, document_id)
);
CREATE INDEX idx_course_documents_doc ON course_documents(document_id);

CREATE TABLE concept_maps (
    doc_hash     TEXT NOT NULL,
    version      INTEGER NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
    stage        TEXT,
    data_json    TEXT,
    error        TEXT,
    model        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (doc_hash, version)
);
