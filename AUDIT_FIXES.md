# Backend audit – round 1 (bugs & easy fixes)

Run `cd backend && pip install -r requirements-dev.txt && pytest -v` (100 tests, ~50 s, offline).

## Fixed
**Broken features**
- Upload always failed: cleanup glob deleted the new PDF/meta and crashed on the index folder. Now build-then-swap; sessions are restored after restart (with owner).
- Quiz options were mangled ("A deterministic…"→"deterministic…", "B-cell"→"cell"). Labels are now stripped only when consistently A/B/C/D-labelled.
- Unmappable correct answers were silently graded as option 1; fake "Option D" padding; duplicate questions across batches → such questions are now dropped.
- Topic check ignored punctuation/plurals ("Mitosis," ≠ "mitosis"). `sources` leaked server file paths → now "file.pdf · p.4".
- Email change wasn't lower-cased → user could no longer log in. Profile edits now validated like registration.
- Bad `top_k` in /quiz and /notes was a 500 → 400. Leaderboard garbage input was a 500. bcrypt>=5 raised on >72-byte passwords.
- Leaderboard preload used a different key format, so a restart emptied every board.

**Security**
- LLM client cache keyed on the first 8 chars of the API key → one user could run on another's key. Now SHA-256 of the whole key.
- `session_id` used in file paths/globs unvalidated (`*` could wipe everyone's files; `../` escaped uploads). Strict format check; upload checks ownership.
- Chat history readable across users; ownership check failed open. Now filtered by user in SQL and fail-closed.
- Free equipment: /avatar/update & hero-forge accepted any item, and bonuses applied to anything equipped. Now ownership-checked, and bonuses only count owned items.
- Free potions via /arena/sync-inventory → client may only report ≤ what the server says they hold.
- ENCRYPTION_KEY now mandatory (was a public default); JWT re-checked against DB (deleted accounts); delete-account removes history, progression, leaderboard rows and uploads.
- Client-supplied reward numbers clamped (NaN/inf/huge); arena/boss/prefetch inputs validated and size-bounded; boss HP clamped.

**Concurrency**
- Atomic SQL for coins, daily caps, quest claims, potion use, achievement unlocks, XP/coins (no more lost updates, double claims, cap bypass, double-spend).
- Blocking LLM / embedding / key-validation calls moved off the event loop (one slow request no longer freezes the server).

**Smaller**: idle-based session expiry; per-user session cap; streak freezes cost one per missed day; achievement XP now updates level; custom 429 body so rate-limiting doesn't show the "quota exceeded" popup; error messages no longer echo internals; embedding model warm-up at boot; docs corrected (bge-large, not MiniLM).

## Behaviour changes to be aware of
- Server won't start without `ENCRYPTION_KEY` (`ALLOW_INSECURE_DEV_KEY=true` for a one-time migration).
- Source PDFs are deleted after indexing (only the FAISS index is kept).
- Sessions expire after 24 h *idle*; max 10 documents per user (`MAX_SESSIONS_PER_USER`).
- Quizzes may return fewer questions than requested when the model produced invalid ones.
- Leaderboard topics are case/space-insensitive; the server decides the date.

## NOT fixed yet (needs the arena/server-authority work)
- `/rewards/award` and `/arena/leaderboard` still trust the browser's claim that a quiz/boss fight happened (now strictly capped per day, but still farmable up to the caps).
- Arena combat, answers and HP are still client-side; `game.js` XSS surface and `?backend_url=` param.
- JWT revocation on logout/password change; streak/cap day boundary is UTC (05:30 IST); cross-domain cookie settings for production.
- FAISS `allow_dangerous_deserialization`; follow-up-question query rewriting; pinned `requirements.txt`.
- Not tested here: the real embedding model, real LLM providers, Windows, the frontend.
