-- 0007: Arena v2 (docs/arena-v2.md) - tactical turns, concept mastery + Nemesis, Expedition runs.
--
--   * arena_battles gains the turn state the server owns: Focus (the move/spell resource), the boss's telegraphed
--     intent for the coming turn, the boss's shield, the mode (quick | nemesis | expedition) and, for a fight inside
--     an Expedition, the run it belongs to (its end flows back into that run in the same transaction).
--   * arena_questions remembers the move the question was issued for (its tier and time follow the move) and
--     whether a timewarp was already cast on it.
--   * concept_mastery     per user + document + concept: how often it was seen / answered right, the current
--                         wrong streak. Written by arena answers, server-graded quiz answers and flashcard reviews.
--   * missed_questions    the questions a user got wrong (arena + quiz), for battle "loot" and the review deck.
--                         One row per question text per document (a second miss refreshes it).
--   * arena_runs          Expedition runs: seeded node map, hearts / gold / relics carried from fight to fight,
--                         status active -> won | lost | abandoned exactly once (compare-and-set); the run's single
--                         expedition_complete reward is written in that same transaction.
CREATE TABLE arena_runs (
    id              TEXT PRIMARY KEY,                       -- the run_id handed to the client
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id      TEXT NOT NULL,                          -- the document the run goes through
    doc_hash        TEXT NOT NULL,
    difficulty      TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'nightmare')),
    seed            INTEGER NOT NULL,                       -- the map of every act is derived from this
    acts_json       TEXT NOT NULL,                          -- [{title, topic}] x 3, extracted by the LLM at the start
    map_json        TEXT NOT NULL,                          -- the generated maps (a pure function of seed + acts)
    nemesis_ok      INTEGER NOT NULL DEFAULT 0,             -- weak-concept data existed at the start: nemesis nodes
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost', 'abandoned')),
    act             INTEGER NOT NULL DEFAULT 1,
    node_id         TEXT,                                   -- where the player stands (NULL = at the start of the act)
    visited_json    TEXT NOT NULL DEFAULT '[]',
    hearts          INTEGER NOT NULL,
    max_hearts      INTEGER NOT NULL,
    gold            INTEGER NOT NULL DEFAULT 0,
    relics_json     TEXT NOT NULL DEFAULT '[]',
    flags_json      TEXT NOT NULL DEFAULT '{}',             -- once-per-run relic state (phoenix_ash used ...)
    focus_cap       INTEGER NOT NULL DEFAULT 5,
    act_focus_bonus INTEGER NOT NULL DEFAULT 0,             -- rest "study": +1 Focus at the start of each battle this act
    pending_json    TEXT,                                   -- a choice the player must make (rest / shop / relic)
    battle_id       TEXT,                                   -- the fight in progress, if any
    depth           INTEGER NOT NULL DEFAULT 0,             -- nodes cleared
    battles_won     INTEGER NOT NULL DEFAULT 0,
    answered        INTEGER NOT NULL DEFAULT 0,             -- summed from the run's finished battles
    correct         INTEGER NOT NULL DEFAULT 0,
    score           INTEGER NOT NULL DEFAULT 0,
    rewards_json    TEXT,
    result_json     TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    finished_at     TEXT
);
CREATE INDEX idx_arena_runs_user ON arena_runs(user_id, created_at);
CREATE INDEX idx_arena_runs_board ON arena_runs(doc_hash, status, score);
CREATE INDEX idx_arena_runs_finished ON arena_runs(finished_at, score);
-- one active run per user per document
CREATE UNIQUE INDEX idx_arena_runs_active ON arena_runs(user_id, session_id) WHERE status = 'active';

ALTER TABLE arena_battles ADD COLUMN mode TEXT NOT NULL DEFAULT 'quick' CHECK (mode IN ('quick', 'nemesis', 'expedition'));
ALTER TABLE arena_battles ADD COLUMN run_id TEXT REFERENCES arena_runs(id) ON DELETE CASCADE;
ALTER TABLE arena_battles ADD COLUMN focus INTEGER NOT NULL DEFAULT 0;
ALTER TABLE arena_battles ADD COLUMN focus_cap INTEGER NOT NULL DEFAULT 5;
ALTER TABLE arena_battles ADD COLUMN shield INTEGER NOT NULL DEFAULT 0;
ALTER TABLE arena_battles ADD COLUMN intent_json TEXT;           -- {kind, name, value, description}: this turn's telegraph
CREATE INDEX idx_arena_battles_run ON arena_battles(run_id);
CREATE INDEX idx_arena_scores_global ON arena_scores(difficulty, created_at);

ALTER TABLE arena_questions ADD COLUMN move TEXT;                 -- strike | jab | heavy | guard (NULL while queued)
ALTER TABLE arena_questions ADD COLUMN timewarped INTEGER NOT NULL DEFAULT 0;

CREATE TABLE concept_mastery (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_hash      TEXT NOT NULL,
    concept_key   TEXT NOT NULL,                            -- normalised concept (question_key)
    concept       TEXT NOT NULL,                            -- as last written
    seen          INTEGER NOT NULL DEFAULT 0,
    correct       INTEGER NOT NULL DEFAULT 0,
    wrong_streak  INTEGER NOT NULL DEFAULT 0,
    last_seen_at  TEXT NOT NULL,
    last_wrong_at TEXT,
    PRIMARY KEY (user_id, doc_hash, concept_key)
);

CREATE TABLE missed_questions (
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_hash       TEXT NOT NULL,
    text_key       TEXT NOT NULL,                           -- normalised question text
    concept_key    TEXT NOT NULL,
    concept        TEXT NOT NULL,
    source         TEXT NOT NULL CHECK (source IN ('arena', 'quiz')),
    question       TEXT NOT NULL,
    correct_answer TEXT NOT NULL,
    explanation    TEXT,
    missed_at      TEXT NOT NULL,
    PRIMARY KEY (user_id, doc_hash, text_key)
);
CREATE INDEX idx_missed_questions_concept ON missed_questions(user_id, doc_hash, concept_key);
