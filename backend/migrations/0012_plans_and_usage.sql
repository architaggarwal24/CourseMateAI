-- 0012: plans, usage metering and invite codes (Phase 3, Stage 4a; docs/plans.md).
--
--   * user_plans      the plan a user is on when it isn't the server default (DEFAULT_TIER): from an invite code,
--                     set by an admin, or (Stage 4c) a paid subscription. `expires_at` NULL = no end; once it has
--                     passed the user is back on the default plan (the row stays, for the history).
--   * usage_daily     what each user used per UTC day: AI calls and tokens (in / out), and the share of the calls
--                     made with the user's own provider key (those are outside the plan's AI quotas).
--   * invite_codes    a code grants a plan for some days, a limited number of times; INVITE_ONLY=1 makes signup
--                     need one. invite_redemptions records who used which (one use per user per code).

CREATE TABLE user_plans (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    tier         TEXT NOT NULL CHECK (tier IN ('apprentice', 'scholar', 'sage', 'archmage')),
    source       TEXT NOT NULL CHECK (source IN ('invite', 'admin', 'subscription')),
    source_ref   TEXT,
    started_at   TEXT NOT NULL,
    expires_at   TEXT,
    updated_at   TEXT NOT NULL
);

CREATE TABLE usage_daily (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day          TEXT NOT NULL,
    ai_calls     INTEGER NOT NULL DEFAULT 0,
    byok_calls   INTEGER NOT NULL DEFAULT 0,
    tokens_in    INTEGER NOT NULL DEFAULT 0,
    tokens_out   INTEGER NOT NULL DEFAULT 0,
    byok_tokens  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);

CREATE TABLE invite_codes (
    code         TEXT PRIMARY KEY,
    tier         TEXT NOT NULL CHECK (tier IN ('apprentice', 'scholar', 'sage', 'archmage')),
    days         INTEGER,
    max_uses     INTEGER NOT NULL DEFAULT 1,
    uses         INTEGER NOT NULL DEFAULT 0,
    note         TEXT,
    created_at   TEXT NOT NULL,
    expires_at   TEXT,
    revoked      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE invite_redemptions (
    code         TEXT NOT NULL REFERENCES invite_codes(code) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redeemed_at  TEXT NOT NULL,
    PRIMARY KEY (code, user_id)
);
CREATE INDEX idx_invite_redemptions_user ON invite_redemptions(user_id);
