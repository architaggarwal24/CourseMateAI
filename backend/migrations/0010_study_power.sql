-- 0010: study power (Phase 3, Stage 3A): the spaced-repetition review queue and exam mode.
--
--   * review_items     ONE queue per user, scheduled with FSRS (services/review_service.py, the `fsrs` package).
--                      A card comes from a graded flashcard, a missed arena question ("study scroll"), a missed
--                      quiz question or a missed exam question. Keyed by document HASH + normalised front text,
--                      like missed_questions, so a re-uploaded PDF keeps its cards and a card is never queued twice.
--                      reps = 0 means "new" (never reviewed). The FSRS card state is stored as columns.
--   * review_logs      every grade (1 Again, 2 Hard, 3 Good, 4 Easy), on the user's LOCAL date: today's counts,
--                      the new-cards-per-day limit, and the history a later FSRS parameter optimiser needs.
--   * exams / exam_questions / exam_answers
--                      a timed mock test from a document. The correct answers stay on the server; answers can be
--                      changed until the exam is submitted (or its deadline passes), then it is graded once.
--   * missed_questions is rebuilt so an exam miss can be stored too (source 'exam'); every row is kept, and every
--     existing missed question becomes a review card, due now.

CREATE TABLE review_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_hash     TEXT NOT NULL,
    item_key     TEXT NOT NULL,                                  -- normalised front text
    source       TEXT NOT NULL CHECK (source IN ('flashcard', 'arena', 'quiz', 'exam')),
    concept      TEXT,
    concept_key  TEXT,
    front        TEXT NOT NULL,
    back         TEXT NOT NULL,
    explanation  TEXT,
    state        INTEGER NOT NULL DEFAULT 1 CHECK (state IN (1, 2, 3)),   -- FSRS: 1 learning, 2 review, 3 relearning
    step         INTEGER,
    stability    REAL,
    difficulty   REAL,
    due          TEXT NOT NULL,                                  -- UTC, ISO seconds (string order = time order)
    last_review  TEXT,
    reps         INTEGER NOT NULL DEFAULT 0,
    lapses       INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE (user_id, doc_hash, item_key)
);
CREATE INDEX idx_review_items_due ON review_items(user_id, due);

CREATE TABLE review_logs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id      INTEGER NOT NULL REFERENCES review_items(id) ON DELETE CASCADE,
    rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
    was_new      INTEGER NOT NULL DEFAULT 0,
    reviewed_at  TEXT NOT NULL,
    local_date   TEXT NOT NULL,
    duration_ms  INTEGER
);
CREATE INDEX idx_review_logs_day ON review_logs(user_id, local_date);

CREATE TABLE exams (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id     TEXT NOT NULL,
    doc_hash       TEXT NOT NULL,
    doc_name       TEXT NOT NULL,
    length         INTEGER NOT NULL,
    difficulty     TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'mixed')),
    topics_json    TEXT NOT NULL DEFAULT '[]',
    time_limit_s   INTEGER NOT NULL,
    started_at     TEXT NOT NULL,
    deadline       TEXT NOT NULL,
    submitted_at   TEXT,
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'graded')),
    score          INTEGER,
    total          INTEGER NOT NULL,
    accuracy       REAL,
    time_used_s    INTEGER,
    breakdown_json TEXT,
    auto_submitted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_exams_user ON exams(user_id, started_at);

CREATE TABLE exam_questions (
    exam_id        TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    idx            INTEGER NOT NULL,
    question       TEXT NOT NULL,
    options_json   TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    explanation    TEXT,
    concept        TEXT NOT NULL,
    difficulty     TEXT NOT NULL,
    PRIMARY KEY (exam_id, idx)
);

CREATE TABLE exam_answers (
    exam_id      TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    answer       TEXT,
    flagged      INTEGER NOT NULL DEFAULT 0,
    correct      INTEGER,
    answered_at  TEXT NOT NULL,
    PRIMARY KEY (exam_id, idx)
);

-- missed_questions: allow source 'exam' (SQLite can't change a CHECK in place: copy, swap).
CREATE TABLE missed_questions_new (
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_hash       TEXT NOT NULL,
    text_key       TEXT NOT NULL,
    concept_key    TEXT NOT NULL,
    concept        TEXT NOT NULL,
    source         TEXT NOT NULL CHECK (source IN ('arena', 'quiz', 'exam')),
    question       TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    explanation    TEXT,
    missed_at      TEXT NOT NULL,
    PRIMARY KEY (user_id, doc_hash, text_key)
);
INSERT INTO missed_questions_new SELECT user_id, doc_hash, text_key, concept_key, concept, source, question,
       correct_answer, explanation, missed_at FROM missed_questions;
DROP TABLE missed_questions;
ALTER TABLE missed_questions_new RENAME TO missed_questions;
CREATE INDEX idx_missed_questions_concept ON missed_questions(user_id, doc_hash, concept_key);

-- Every study scroll already missed becomes a review card, due now (well, when it was missed).
INSERT INTO review_items (user_id, doc_hash, item_key, source, concept, concept_key, front, back, explanation,
                          due, created_at, updated_at)
SELECT user_id, doc_hash, text_key, source, concept, concept_key, question, correct_answer, explanation,
       missed_at, missed_at, missed_at
FROM missed_questions WHERE TRIM(correct_answer) <> '';
