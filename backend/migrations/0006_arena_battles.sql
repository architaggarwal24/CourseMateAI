-- 0006: server-authoritative arena battles.
--
-- A battle lives here, not in the browser: the boss, hearts, phase, combo and every question WITH its correct
-- answer are stored server-side; the browser only ever sees the current question's text and options.
--   * arena_battles          one row per fight. status moves active -> won | lost exactly once (compare-and-set),
--                            and the rewards are written in that same transaction, so a finish can't pay twice.
--   * arena_questions        the question pool of a battle, in the order they are asked. An answered question
--                            keeps its first answer (status issued -> answered, compare-and-set).
--   * arena_scores           the leaderboard: one row per WON battle (battle_id is the key, so it is written once).
--                            board_key = normalised topic | difficulty | document hash.
--   * arena_personal_bests   the best result of each user per board.
-- The old `leaderboard` table (browser-reported, daily) is no longer written.
CREATE TABLE arena_battles (
    id             TEXT PRIMARY KEY,                       -- the battle_id handed to the client
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id     TEXT NOT NULL,                          -- the document the battle is about
    doc_hash       TEXT NOT NULL,                          -- that document's content hash (part of the board key)
    topic          TEXT NOT NULL,
    difficulty     TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard', 'nightmare')),
    board_key      TEXT NOT NULL,
    boss_json      TEXT NOT NULL,                          -- the whole boss: persona, taunts, current_hp, phase, rage
    status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'won', 'lost')),
    phase          INTEGER NOT NULL DEFAULT 1,
    boss_hp        INTEGER NOT NULL,
    boss_max_hp    INTEGER NOT NULL,
    player_hp      INTEGER NOT NULL,
    player_max_hp  INTEGER NOT NULL,
    combo          INTEGER NOT NULL DEFAULT 0,
    max_combo      INTEGER NOT NULL DEFAULT 0,
    answered       INTEGER NOT NULL DEFAULT 0,
    correct        INTEGER NOT NULL DEFAULT 0,
    heals_used     INTEGER NOT NULL DEFAULT 0,
    fifty_used     INTEGER NOT NULL DEFAULT 0,
    active_ms      INTEGER NOT NULL DEFAULT 0,             -- time spent on questions, measured by the server
    current_seq    INTEGER,                                -- the question that is issued and not answered yet
    gen_attempts_1 INTEGER NOT NULL DEFAULT 0,             -- question batches generated per phase (bounded)
    gen_attempts_2 INTEGER NOT NULL DEFAULT 0,
    rewards_json   TEXT,                                   -- what the finish paid (NULL until finished)
    result_json    TEXT,                                   -- grade / accuracy / time of the finished battle
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    finished_at    TEXT
);
CREATE INDEX idx_arena_battles_user ON arena_battles(user_id, created_at);
-- one fight at a time per document: this is what lets a page refresh find (and resume) the same battle
CREATE UNIQUE INDEX idx_arena_battles_active ON arena_battles(user_id, session_id) WHERE status = 'active';

CREATE TABLE arena_questions (
    battle_id    TEXT NOT NULL REFERENCES arena_battles(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,                         -- 1, 2, 3 ... the order they are asked
    phase        INTEGER NOT NULL,
    concept_key  TEXT NOT NULL,                            -- normalised concept: a battle never asks one twice
    text_key     TEXT NOT NULL,                            -- normalised question text
    question_json TEXT NOT NULL,                           -- full question incl. correct_answer + explanation (server only)
    status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'issued', 'answered')),
    options_json TEXT,                                     -- the options in the shuffled order the player saw
    removed_json TEXT,                                     -- options hidden by a 50/50
    issued_at    TEXT,
    deadline_at  TEXT,
    answer       TEXT,
    correct      INTEGER,
    timed_out    INTEGER,
    answered_at  TEXT,
    outcome_json TEXT,                                     -- the stored result, returned again on a replay
    PRIMARY KEY (battle_id, seq)
);
CREATE INDEX idx_arena_questions_pool ON arena_questions(battle_id, phase, status);

CREATE TABLE arena_scores (
    battle_id    TEXT PRIMARY KEY REFERENCES arena_battles(id) ON DELETE CASCADE,
    board_key    TEXT NOT NULL,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username     TEXT NOT NULL,
    topic        TEXT NOT NULL,
    topic_key    TEXT NOT NULL,                            -- normalised topic (lower-case, single spaces)
    difficulty   TEXT NOT NULL,
    doc_hash     TEXT NOT NULL,
    grade        TEXT NOT NULL,
    accuracy     INTEGER NOT NULL,                         -- 0-100, from the stored answers
    time_seconds INTEGER NOT NULL,                         -- from the server's own clock
    created_at   TEXT NOT NULL
);
CREATE INDEX idx_arena_scores_board ON arena_scores(topic_key, difficulty, doc_hash, accuracy, time_seconds);
CREATE INDEX idx_arena_scores_user  ON arena_scores(user_id);

CREATE TABLE arena_personal_bests (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    board_key    TEXT NOT NULL,
    battle_id    TEXT NOT NULL,
    grade        TEXT NOT NULL,
    accuracy     INTEGER NOT NULL,
    time_seconds INTEGER NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (user_id, board_key)
);
