# PostgreSQL (optional) (Phase 3, Stage 4e)

SQLite stays the default. `DATABASE_URL=postgresql://user:password@host:5432/dbname` switches the whole app to PostgreSQL, with no code changes in the services.

## How

- **One connection factory.** `database/connection.connect()` hands out the adapter in `database/pg.py` for a `postgresql://` URL. The adapter has the same surface as `sqlite3.Connection` and translates SQLite's SQL on the way:

  | SQLite | PostgreSQL |
  |---|---|
  | `?` placeholders | `%s` (and `%` → `%%`) |
  | `INSERT OR IGNORE INTO …` | `INSERT INTO … ON CONFLICT DO NOTHING` |
  | a bare column in `ON CONFLICT … DO UPDATE SET` | `table.column` (PostgreSQL calls the bare name ambiguous) |
  | `MIN(a, b)` / `MAX(a, b)` | `LEAST` / `GREATEST` |
  | `BEGIN IMMEDIATE` | `BEGIN` |
  | `PRAGMA …` | nothing (the integrity checks answer "ok") |
  | rows by name and position, numbers as int | the same (`NUMERIC` sums come back as int / float) |
  | `sqlite3.IntegrityError` / `OperationalError` | raised the same, so `except` clauses work |
  | a failed statement inside a transaction rolls back alone | each statement runs under a `SAVEPOINT` |

  The code was made portable where it was SQLite-only: `RETURNING id` instead of `lastrowid`, `LOWER(username)` instead of `COLLATE NOCASE`, the activity-log cutoff computed in Python, and no `rowid`.
- **Schema:** `migrations/postgres/0014_baseline.sql` equals SQLite's schema after migrations 0001–0014.
  - `scripts/postgres_schema.py` generates it: INTEGER → BIGINT, `id` → identity columns, timestamps kept as the same ISO text, foreign-key order, and the append-only `reward_events` triggers in PL/pgSQL.
  - **Every later migration needs a PostgreSQL twin** with the same number and name; `tests/test_postgres.py` fails otherwise.
  - Migrations take an advisory lock, so two processes can't race.

## Moving an existing SQLite database

```sh
# from backend/; the SQLite file is only read
python scripts/sqlite_to_postgres.py --sqlite data/coursemate.db --url postgresql://coursemate:pw@localhost:5432/coursemate
```

The script:

1. Checks that the SQLite file is at the newest migration and that the PostgreSQL database is empty.
2. Migrates the PostgreSQL database.
3. Copies every table in foreign-key order with `COPY`, in one transaction.
4. Moves the identity counters past the copied ids and compares the row counts.

Then set `DATABASE_URL` and restart. Keep the SQLite file as your fallback.

## Testing on PostgreSQL

```sh
COURSEMATE_TEST_PG="postgresql://postgres@localhost:5432/postgres" python -m pytest
```

This runs the **whole suite** on a fresh database made for the run (the user must be allowed to create databases). Without it, the suite runs on SQLite and `tests/test_postgres.py` still checks the translation and the baseline.

## Backups

`pg_dump --format=custom -f coursemate.dump "$DATABASE_URL"`, restored with `pg_restore --clean -d "$DATABASE_URL" coursemate.dump`. On the VPS the `backup` profile does this daily (docs/deploy-vps.md).
