-- 0005: server-side quizzes.
--
-- A generated quiz is stored here with its correct answers and explanations; the browser only ever gets the
-- questions. Each question can be answered ONCE (quiz_answers' primary key), and a quiz can be finished ONCE
-- (finished_at is set by a compare-and-set), which is what makes its quiz_complete reward claimable exactly once.
CREATE TABLE quizzes (
    id             TEXT PRIMARY KEY,                       -- the quiz_id handed to the client
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id     TEXT NOT NULL,                          -- the document the quiz was made from
    topic          TEXT NOT NULL,
    question_type  TEXT NOT NULL,
    questions_json TEXT NOT NULL,                          -- full questions incl. correct_answer + explanation (server only)
    question_count INTEGER NOT NULL,
    created_at     TEXT NOT NULL,
    finished_at    TEXT,                                   -- NULL until /quiz/finish; set exactly once
    correct_count  INTEGER,
    accuracy       REAL
);
CREATE INDEX idx_quizzes_user ON quizzes(user_id, created_at);

CREATE TABLE quiz_answers (
    quiz_id     TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL,
    answer      TEXT NOT NULL,                             -- the option the user picked (first answer wins)
    correct     INTEGER NOT NULL,
    answered_at TEXT NOT NULL,
    PRIMARY KEY (quiz_id, question_id)
);
