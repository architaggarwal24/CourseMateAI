-- 0013: model routing costs and the per-document quiz bank (Phase 3, Stage 4b; docs/model-routing.md).
--
--   * usage_daily.cost_micro_usd   what a user's AI calls cost that day, in millionths of a US dollar (the
--                     provider prices in MODEL_PRICES_JSON; a model with no price counts 0 and is listed as unpriced)
--   * model_usage_daily            per day, provider, model and job (small / strong): calls, tokens, cost and how
--                     often the call fell back to the next model - for the operator (scripts/admin.py costs)
--   * quiz_bank       every quiz question ever generated for a document's CONTENT (file hash) and topic, shared by
--                     every user with the same PDF: a quiz is served from it, without an AI call, when it holds
--                     enough questions the user hasn't had yet. quiz_bank_served remembers who had which.

ALTER TABLE usage_daily ADD COLUMN cost_micro_usd INTEGER NOT NULL DEFAULT 0;

CREATE TABLE model_usage_daily (
    day             TEXT NOT NULL,
    provider        TEXT NOT NULL,
    model           TEXT NOT NULL,
    job             TEXT NOT NULL,
    calls           INTEGER NOT NULL DEFAULT 0,
    tokens_in       INTEGER NOT NULL DEFAULT 0,
    tokens_out      INTEGER NOT NULL DEFAULT 0,
    cost_micro_usd  INTEGER NOT NULL DEFAULT 0,
    fallbacks       INTEGER NOT NULL DEFAULT 0,
    byok_calls      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, provider, model, job)
);

CREATE TABLE quiz_bank (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_hash        TEXT NOT NULL,
    topic_key       TEXT NOT NULL,
    question_type   TEXT NOT NULL,
    text_key        TEXT NOT NULL,
    question_json   TEXT NOT NULL,
    model           TEXT,
    created_at      TEXT NOT NULL,
    UNIQUE (doc_hash, topic_key, question_type, text_key)
);
CREATE INDEX idx_quiz_bank_lookup ON quiz_bank(doc_hash, topic_key, question_type);

CREATE TABLE quiz_bank_served (
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bank_id         INTEGER NOT NULL REFERENCES quiz_bank(id) ON DELETE CASCADE,
    served_at       TEXT NOT NULL,
    PRIMARY KEY (user_id, bank_id)
);
