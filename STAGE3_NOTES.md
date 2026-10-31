# Stage 3 — Arena v2 backend

Unzip over `CourseMateAI/`. Backend files + `docs/arena-v2.md` (the full spec and implementation notes, section 7)
+ the regenerated frontend API types (`frontend/src/lib/api/generated/schema.d.ts`, so the frontend's schema test stays green).
No new Python packages. Migration **0007_arena_v2.sql** applies itself on the next backend start (existing battles keep working).

The current arena screen keeps working with this backend: a client that sends no move gets a Strike. The new screens are Stage 4.

## What's new (server-side, all authoritative)
- **Tactical turns**: `GET /arena/battles/{id}/question?move=strike|jab|heavy|guard`; Focus (0–5); boss **intents** rolled each turn
  (attack / heavy / shield / drain / heal) and returned in battle state + `next_intent` on every answer; Guard blocks, right
  Strike/Heavy interrupts a heal, shields absorb damage. Spells: `POST /arena/battles/{id}/spells {insight|timewarp}`.
- **Concept mastery** from arena answers, quiz answers and `POST /study/flashcards/review`. `GET /arena/weak-concepts`.
- **Nemesis**: `POST /arena/battles {mode:"nemesis"}` builds a boss from your weak concepts (needs 3 missed).
- **Study scrolls**: finished battles list `result.missed`; `GET /study/review-deck` turns missed questions into flashcards (no LLM).
- **Expedition**: `POST /arena/runs`, `/runs/active`, `/runs/{id}/travel|choose|abandon`, run leaderboard. 3 acts from your PDF,
  seeded branching maps, 12 relics (`backend/content/relics.json`), shop/rest/treasure, hearts carry over, one payout (`expedition_complete`).
- **Weekly global leaderboard** (`scope=global`).
- Independent security review done; all 8 findings fixed (abandon accuracy exploit, spells after deadline, LLM call before a 409,
  run payout in the final answer, "out of questions" is now retryable instead of a loss, pre-migration intents, dead-run resume, difficulty mismatch).

## What to test
1. `cd backend && pytest -q` → **833 passed** (1 known failure needs internet DNS: `test_fixed_provider_ignores_user_supplied_url`).
2. `cd frontend && npm test` → all pass (types regenerated).
3. Start the backend, open **http://localhost:8000/docs**: the new endpoints are listed under arena / study.
4. Existing arena (current UI) still plays normally against the new backend.
5. Optional, with a PDF uploaded and logged in (from /docs "Try it out"): `POST /arena/runs {session_id, difficulty:"easy"}` → a run with 3 acts and a map.
