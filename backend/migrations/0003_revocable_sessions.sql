-- 0003: revocable login sessions.
--
-- The `sessions` table from 0001 was never used: logins were stateless 7-day JWTs that nothing could revoke.
-- Now every login is one row here. `id` is the HMAC of the random session token held in the browser's cookie
-- (the token itself is never stored), and a request is authenticated only while its row exists and has not
-- expired - so logout, a password change and account deletion take effect immediately.
--
-- Rows from before this migration were never read by anything and cannot match a token: drop them.
DELETE FROM sessions;
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
