"""PostgreSQL support (Phase 3 Stage 4e, docs/postgres.md): the SQL translation, the baseline kept in step with the
SQLite migrations, and - when a server is given (COURSEMATE_TEST_PG) - the copy from SQLite."""
import os
import sqlite3
from pathlib import Path

import pytest

from database import pg
from database.migrate import MIGRATIONS_DIR, PG_MIGRATIONS_DIR, discover, discover_pg, migrate

PG_ADMIN = os.environ.get("COURSEMATE_TEST_PG", "").strip()


def test_placeholders_and_percent_signs():
    assert pg.translate("SELECT * FROM t WHERE a = ? AND b LIKE ?") == "SELECT * FROM t WHERE a = %s AND b LIKE %s"
    assert pg.translate("SELECT '?' AS q, x FROM t WHERE y = ?") == "SELECT '?' AS q, x FROM t WHERE y = %s"
    assert pg.translate("SELECT 5 % 2 FROM t WHERE y = ?") == "SELECT 5 %% 2 FROM t WHERE y = %s"
    assert pg.translate("SELECT 5 % 2", has_params=False) == "SELECT 5 % 2"


def test_insert_or_ignore_and_upserts():
    assert pg.translate("INSERT OR IGNORE INTO a (x) VALUES (?)") == "INSERT INTO a (x) VALUES (%s) ON CONFLICT DO NOTHING"
    assert pg.translate("INSERT OR IGNORE INTO a (x) VALUES (?) RETURNING id") == \
        "INSERT INTO a (x) VALUES (%s) ON CONFLICT DO NOTHING RETURNING id"
    up = pg.translate("INSERT INTO c (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) "
                      "DO UPDATE SET n = n + excluded.n WHERE n < ? RETURNING n")
    assert up.endswith("DO UPDATE SET n = c.n + excluded.n WHERE c.n < %s RETURNING n")


def test_scalar_min_and_max():
    assert pg.translate("SELECT MAX(a) FROM t") == "SELECT MAX(a) FROM t"
    assert pg.translate("UPDATE t SET due = MIN(due, ?), n = MAX(n, (1 + 2))") == \
        "UPDATE t SET due = LEAST(due, %s), n = GREATEST(n, (1 + 2))"


def test_rows_read_by_name_and_position_and_numbers_come_back_as_numbers():
    from decimal import Decimal
    r = pg.Row(["a", "b"], [1, "x"])
    assert (r["a"], r[1], dict(r), list(r), len(r)) == (1, "x", {"a": 1, "b": "x"}, [1, "x"], 2)
    assert pg._value(Decimal("3")) == 3 and isinstance(pg._value(Decimal("3")), int) and pg._value(Decimal("2.5")) == 2.5
    assert pg._param(True) == 1
    import datetime as dt
    assert pg._value(dt.date(2026, 3, 10)) == "2026-03-10"            # dates read as text, like SQLite
    assert pg._value(dt.datetime(2026, 3, 10, 4, 5, 6)) == "2026-03-10 04:05:06"


def test_every_sqlite_migration_after_the_baseline_has_a_postgres_twin():
    sqlite_migs, pg_migs = discover(), discover_pg()
    baseline = pg_migs[0].version
    assert [m.version for m in pg_migs] == list(range(baseline, sqlite_migs[-1].version + 1))
    names = {m.version: m.name for m in sqlite_migs}
    assert all(m.name == names[m.version] for m in pg_migs[1:])


def test_the_baseline_is_what_the_generator_makes_now():
    import importlib.util
    spec = importlib.util.spec_from_file_location("pg_schema", Path(__file__).resolve().parent.parent / "scripts" / "postgres_schema.py")
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    version, sql = gen.baseline_sql()
    base = discover_pg()[0]
    if base.version == version:                     # once later migrations exist the baseline stays as it was
        assert sql == (PG_MIGRATIONS_DIR / f"{version:04d}_baseline.sql").read_text(encoding="utf-8"), \
            "run scripts/postgres_schema.py"


# ── against a real server ────────────────────────────────────────────────────
needs_pg = pytest.mark.skipif(not PG_ADMIN, reason="set COURSEMATE_TEST_PG=postgresql://... to run")


def _fresh_pg(name):
    import psycopg
    from urllib.parse import urlsplit, urlunsplit
    with psycopg.connect(PG_ADMIN, autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{name}"')
        c.execute(f'CREATE DATABASE "{name}"')
    u = urlsplit(PG_ADMIN)
    return urlunsplit((u.scheme, u.netloc, "/" + name, u.query, ""))


@needs_pg
def test_the_copy_moves_every_row_and_ids_carry_on(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("s2p", Path(__file__).resolve().parent.parent / "scripts" / "sqlite_to_postgres.py")
    s2p = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(s2p)
    db = tmp_path / "coursemate.db"
    migrate(db)
    c = sqlite3.connect(db)
    c.execute("PRAGMA foreign_keys=ON")
    for i in (1, 2, 5):
        c.execute("INSERT INTO users (id, email, username, full_name, password_hash) VALUES (?, ?, ?, 'U', 'h')",
                  (i, f"u{i}@x.io", f"u{i}"))
    c.execute("INSERT INTO user_progress (user_id, total_xp, coins, created_at, updated_at) VALUES (5, 120, 30, 't', 't')")
    c.execute("INSERT INTO reward_events (user_id, kind, xp, coins, idempotency_key, created_at) VALUES (5, 'k', 120, 30, 'a', 't')")
    c.execute("INSERT INTO usage_daily (user_id, day, ai_calls) VALUES (2, '2026-11-04', 7)")
    c.commit(); c.close()
    url = _fresh_pg(f"cm_copy_{os.getpid()}")
    counts = s2p.copy(str(db), url, out=lambda *_: None)
    assert counts["users"] == 3 and counts["reward_events"] == 1 and counts["usage_daily"] == 1
    conn = pg.Connection(url)
    try:
        assert conn.execute("SELECT total_xp FROM user_progress WHERE user_id = ?", (5,)).fetchone()["total_xp"] == 120
        new_id = conn.execute("INSERT INTO users (email, username, full_name, password_hash) VALUES (?, ?, 'N', 'h') RETURNING id",
                              ("n@x.io", "n")).fetchone()[0]
        assert new_id == 6                                           # the counter moved past the copied ids
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO users (email, username, full_name, password_hash) VALUES ('n@x.io', 'n2', 'N', 'h')")
        with pytest.raises(sqlite3.OperationalError, match="append-only"):
            conn.execute("UPDATE reward_events SET xp = 0")              # the ledger trigger came along
    finally:
        conn.close()
    with pytest.raises(SystemExit, match="already has users"):
        s2p.copy(str(db), url, out=lambda *_: None)


@needs_pg
def test_a_failed_statement_inside_a_transaction_rolls_back_alone():
    url = _fresh_pg(f"cm_tx_{os.getpid()}")
    migrate(url)
    conn = pg.Connection(url)
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("INSERT INTO users (email, username, full_name, password_hash) VALUES ('a@x.io', 'a', 'A', 'h')")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO users (email, username, full_name, password_hash) VALUES ('a@x.io', 'b', 'B', 'h')")
        conn.execute("INSERT INTO users (email, username, full_name, password_hash) VALUES ('c@x.io', 'c', 'C', 'h')")
        conn.commit()
        assert conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] == 2
        assert migrate(url) == []                                        # nothing left to apply
    finally:
        conn.close()
