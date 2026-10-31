-- 0004: append-only reward ledger + per-user time zone.
--
-- reward_events is the audit trail of every XP / coin change: quiz, arena, chat, notes and flashcard
-- rewards, daily-quest claims, achievements, level-up bonuses and shop purchases (negative coins).
-- user_progress.total_xp / coins / current_level are a cache of this table, updated in the same
-- transaction as the event that changes them. idempotency_key is UNIQUE, so the same claim can never be
-- recorded (and paid) twice, even by two server processes racing each other.
CREATE TABLE reward_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL,
    xp              INTEGER NOT NULL DEFAULT 0,
    coins           INTEGER NOT NULL DEFAULT 0,
    source_id       TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_reward_events_user ON reward_events(user_id, id);

-- Append-only: a row can be added but never changed or removed. (Deleting the account still works:
-- the rows go with the user through ON DELETE CASCADE.)
CREATE TRIGGER reward_events_no_update BEFORE UPDATE ON reward_events
BEGIN
    SELECT RAISE(ABORT, 'reward_events is append-only');
END;
CREATE TRIGGER reward_events_no_delete BEFORE DELETE ON reward_events
WHEN EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
BEGIN
    SELECT RAISE(ABORT, 'reward_events is append-only');
END;

-- Balances that existed before the ledger become one opening event per user, so that
-- SUM(events) == the cached totals from day one.
INSERT INTO reward_events (user_id, kind, xp, coins, source_id, idempotency_key, created_at)
SELECT user_id, 'opening_balance', total_xp, coins, NULL, 'opening_balance:' || user_id, created_at
FROM user_progress
WHERE total_xp <> 0 OR coins <> 0;

-- IANA time zone of each user (sent by the browser at sign-up / login). Existing users are 'UTC'.
-- Every "day" in the game (streaks, daily caps, daily quests, the leaderboard day) is this user's
-- local calendar date. The *_utc column names in user_progress / daily_* tables are historical: they now
-- hold that local date (identical to the old values for 'UTC' users).
ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';
