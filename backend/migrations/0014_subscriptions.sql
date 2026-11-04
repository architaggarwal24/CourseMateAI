-- 0014: paid subscriptions (Phase 3, Stage 4c; docs/payments.md).
--
--   * subscriptions   one row per subscription a user started (Razorpay's id, or a stub's in testing): the plan
--                     and billing period it is for, its status as the provider last reported it, and the paid-up
--                     period. The user's plan (user_plans, source 'subscription') follows it: services/billing.py.
--   * payment_events  every webhook event handled, by the provider's event id, so a retried delivery changes
--                     nothing the second time.

CREATE TABLE subscriptions (
    id                    TEXT PRIMARY KEY,
    user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider              TEXT NOT NULL CHECK (provider IN ('razorpay', 'stub')),
    tier                  TEXT NOT NULL CHECK (tier IN ('scholar', 'sage', 'archmage')),
    period                TEXT NOT NULL CHECK (period IN ('month', 'year')),
    status                TEXT NOT NULL,
    short_url             TEXT,
    current_start         TEXT,
    current_end           TEXT,
    cancel_at_period_end  INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id, created_at);

CREATE TABLE payment_events (
    id                TEXT PRIMARY KEY,
    provider          TEXT NOT NULL,
    event             TEXT NOT NULL,
    subscription_id   TEXT,
    received_at       TEXT NOT NULL
);
