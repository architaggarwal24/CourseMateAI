-- 0001: initial schema.
--
-- The combined schema of the two files this replaces:
--   app.db         -> users, sessions, activity_log
--   progression.db -> user_progress, user_avatar, user_buffs, user_inventory, daily_quests,
--                     daily_action_counts, achievements, user_achievements, leaderboard
-- It already includes every column the old startup `ALTER TABLE ...` migrations used to add.
--
-- Every per-user table references users(id) with ON DELETE CASCADE, so deleting a user row
-- removes everything that belongs to them in one statement. user_id is INTEGER everywhere
-- (the progression tables used to store it as TEXT).

CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    username        TEXT NOT NULL UNIQUE,
    full_name       TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login      TIMESTAMP,
    api_key_encrypted TEXT,
    llm_provider    TEXT,
    llm_model       TEXT,
    llm_base_url    TEXT
);

CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at  TIMESTAMP NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE activity_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id  TEXT NOT NULL,
    mode        TEXT NOT NULL,
    action_type TEXT NOT NULL,
    content     TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_activity_user    ON activity_log(user_id, created_at DESC);
CREATE INDEX idx_activity_session ON activity_log(session_id);
CREATE INDEX idx_activity_mode    ON activity_log(mode, user_id);

CREATE TABLE user_progress (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_xp    INTEGER NOT NULL DEFAULT 0,
    current_level INTEGER NOT NULL DEFAULT 1,
    coins       INTEGER NOT NULL DEFAULT 0,

    streak_days INTEGER NOT NULL DEFAULT 0,
    last_active_utc DATE,
    streak_freezes INTEGER NOT NULL DEFAULT 0,

    total_arena_rounds      INTEGER NOT NULL DEFAULT 0,
    total_bosses_defeated   INTEGER NOT NULL DEFAULT 0,
    total_quizzes_completed INTEGER NOT NULL DEFAULT 0,
    total_chat_questions    INTEGER NOT NULL DEFAULT 0,
    total_chat_bundles      INTEGER NOT NULL DEFAULT 0,
    total_notes_generated   INTEGER NOT NULL DEFAULT 0,
    total_flashcards_studied  INTEGER NOT NULL DEFAULT 0,
    best_quiz_accuracy        INTEGER NOT NULL DEFAULT 0,
    nightmare_bosses_defeated INTEGER NOT NULL DEFAULT 0,

    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE user_avatar (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    equipped_json TEXT NOT NULL DEFAULT '{}',
    owned_json    TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE user_buffs (
    user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    buffs_json  TEXT NOT NULL DEFAULT '{}',
    updated_at  TEXT NOT NULL
);

CREATE TABLE user_inventory (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    quantity    INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, item_id)
);

CREATE TABLE daily_action_counts (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action_date_utc DATE NOT NULL,
    action_type TEXT NOT NULL,
    count       INTEGER NOT NULL DEFAULT 0,
    last_ts_utc TEXT,
    PRIMARY KEY (user_id, action_date_utc, action_type)
);

CREATE TABLE daily_quests (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quest_date_utc DATE NOT NULL,
    quest_type  TEXT NOT NULL,
    target_count  INTEGER NOT NULL,
    current_count INTEGER NOT NULL DEFAULT 0,
    reward_xp     INTEGER NOT NULL,
    reward_coins  INTEGER NOT NULL,
    completed   INTEGER NOT NULL DEFAULT 0,
    claimed     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, quest_date_utc, quest_type)
);

-- Catalogue of achievements; seeded from code at startup (INSERT OR IGNORE).
CREATE TABLE achievements (
    achievement_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    unlock_type TEXT NOT NULL,
    unlock_threshold INTEGER NOT NULL,
    reward_xp   INTEGER NOT NULL DEFAULT 0,
    reward_coins INTEGER NOT NULL DEFAULT 0,
    reward_cosmetic_id TEXT,
    tier        TEXT NOT NULL DEFAULT 'common'
);

CREATE TABLE user_achievements (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL REFERENCES achievements(achievement_id),
    unlocked_at_utc TEXT NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
);

-- Daily arena leaderboard (was created lazily at import time in state.py).
CREATE TABLE leaderboard (
    date        TEXT NOT NULL,
    topic       TEXT NOT NULL,
    difficulty  TEXT NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username    TEXT NOT NULL,
    grade       TEXT,
    accuracy    INTEGER DEFAULT 0,
    time_seconds INTEGER DEFAULT 9999,
    PRIMARY KEY (date, topic, difficulty, user_id)
);
CREATE INDEX idx_leaderboard_user ON leaderboard(user_id);
