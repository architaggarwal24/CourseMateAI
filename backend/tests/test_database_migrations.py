"""One database, versioned migrations, enforced foreign keys, and a lossless upgrade from the old two files."""
import hashlib
import importlib.util
import json
import re
import shutil
import sqlite3
from pathlib import Path

import pytest

from database.connection import connect
from database.migrate import (
    DATABASE_FILENAME, MIGRATIONS_DIR, LegacyDatabaseError, MigrationError, discover, migrate, upgrade,
)

BACKEND = Path(__file__).resolve().parent.parent

PER_USER_TABLES = [
    "documents", "sessions", "activity_log", "user_progress", "user_avatar", "user_buffs", "user_inventory",
    "daily_action_counts", "daily_quests", "user_achievements", "leaderboard", "reward_events", "quizzes",
    "arena_battles", "arena_scores", "arena_personal_bests", "arena_runs", "concept_mastery", "missed_questions",
]
ALL_TABLES = {"users", "achievements", "schema_migrations", "quiz_answers", "arena_questions", *PER_USER_TABLES}


def _load_merge_script():
    spec = importlib.util.spec_from_file_location("merge_legacy_dbs", BACKEND / "scripts" / "merge_legacy_dbs.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


merge_script = _load_merge_script()


def signature(db_path):
    """Everything that defines a schema: tables/indexes (normalised SQL) and every foreign key."""
    c = sqlite3.connect(db_path)
    try:
        objs = sorted(
            (t, n, tbl, re.sub(r"\s+", " ", sql).strip())
            for t, n, tbl, sql in c.execute(
                "SELECT type, name, tbl_name, sql FROM sqlite_master "
                "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"))
        fks = sorted(
            (t, tuple(r[2:7]))      # (referenced table, from, to, on_update, on_delete)
            for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            for r in c.execute(f"PRAGMA foreign_key_list({t})"))
        return objs, fks
    finally:
        c.close()


# ── runner ────────────────────────────────────────────────────────────────────
def test_fresh_install_applies_every_migration_once(tmp_path):
    db = tmp_path / DATABASE_FILENAME
    assert migrate(db) == [1, 2, 3, 4, 5, 6, 7]
    assert migrate(db) == []                                   # idempotent
    c = sqlite3.connect(db)
    assert {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")} == ALL_TABLES
    assert c.execute("SELECT version, name FROM schema_migrations").fetchall() == [(1, "initial"), (2, "documents"), (3, "revocable_sessions"),
                                                                                 (4, "reward_events_and_timezones"), (5, "quizzes"),
                                                                                 (6, "arena_battles"), (7, "arena_v2")]


def test_connections_use_wal_foreign_keys_and_busy_timeout(tmp_path):
    c = connect(tmp_path / "x.db")
    assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert c.execute("PRAGMA busy_timeout").fetchone()[0] >= 5000


def _migrations_copy(tmp_path):
    d = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS_DIR, d)
    return d


def test_editing_an_applied_migration_is_detected(tmp_path):
    d = _migrations_copy(tmp_path)
    db = tmp_path / "x.db"
    migrate(db, d)
    f = d / "0001_initial.sql"
    f.write_text(f.read_text(encoding="utf-8") + "\n-- sneaky edit\n", encoding="utf-8")
    with pytest.raises(MigrationError, match="changed after it was applied"):
        migrate(db, d)


def test_checksum_ignores_line_endings(tmp_path):
    d = _migrations_copy(tmp_path)
    db = tmp_path / "x.db"
    migrate(db, d)
    f = d / "0001_initial.sql"
    f.write_bytes(f.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))   # a Windows checkout
    assert migrate(db, d) == []


def test_database_newer_than_code_is_rejected(tmp_path):
    d = _migrations_copy(tmp_path)
    db = tmp_path / "x.db"
    migrate(db, d)
    (d / "0008_more.sql").write_text("CREATE TABLE extra (id INTEGER PRIMARY KEY);\n", encoding="utf-8")
    migrate(db, d)
    (d / "0008_more.sql").unlink()
    with pytest.raises(MigrationError, match="newer version"):
        migrate(db, d)


def test_a_failing_migration_rolls_back_completely(tmp_path):
    d = _migrations_copy(tmp_path)
    db = tmp_path / "x.db"
    migrate(db, d)
    (d / "0008_broken.sql").write_text(
        "CREATE TABLE half_done (id INTEGER PRIMARY KEY);\nINSERT INTO nope VALUES (1);\n", encoding="utf-8")
    with pytest.raises(MigrationError, match="0008_broken.sql failed"):
        migrate(db, d)
    c = sqlite3.connect(db)
    assert c.execute("SELECT name FROM sqlite_master WHERE name = 'half_done'").fetchone() is None
    assert [r[0] for r in c.execute("SELECT version FROM schema_migrations")] == [1, 2, 3, 4, 5, 6, 7]


def test_migration_files_must_be_named_and_consecutive(tmp_path):
    d = tmp_path / "m"
    d.mkdir()
    (d / "0002_x.sql").write_text("SELECT 1;", encoding="utf-8")
    with pytest.raises(MigrationError, match="consecutive"):
        discover(d)
    (d / "0002_x.sql").rename(d / "oops.sql")
    with pytest.raises(MigrationError, match="NNNN_description.sql"):
        discover(d)


# ── foreign keys ──────────────────────────────────────────────────────────────
def _insert_user(c, n=1):
    c.execute("INSERT INTO users (email, username, full_name, password_hash) VALUES (?,?,?,?)",
              (f"u{n}@x.io", f"user{n}", "U", "h"))
    return c.execute("SELECT last_insert_rowid()").fetchone()[0]


def _fill_every_per_user_table(c, uid):
    now = "2026-01-01T00:00:00Z"
    c.execute("INSERT INTO achievements VALUES ('a1','A','d','t',1,0,0,NULL,'common') ON CONFLICT DO NOTHING")
    for sql, args in [
        ("INSERT INTO documents (id, user_id, filename, file_hash, created_at, last_used_at) VALUES (?,?,?,?,?,?)", (f"d{uid}", uid, "a.pdf", "h", now, now)),
        ("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)", (f"s{uid}", uid, now)),
        ("INSERT INTO activity_log (user_id, session_id, mode, action_type) VALUES (?,?,?,?)", (uid, "s", "chat", "q")),
        ("INSERT INTO user_progress (user_id, created_at, updated_at) VALUES (?,?,?)", (uid, now, now)),
        ("INSERT INTO user_avatar (user_id, created_at, updated_at) VALUES (?,?,?)", (uid, now, now)),
        ("INSERT INTO user_buffs (user_id, updated_at) VALUES (?,?)", (uid, now)),
        ("INSERT INTO user_inventory (user_id, item_id) VALUES (?,?)", (uid, "potion")),
        ("INSERT INTO daily_action_counts (user_id, action_date_utc, action_type) VALUES (?,?,?)", (uid, "2026-01-01", "chat")),
        ("INSERT INTO daily_quests VALUES (?,?,?,?,?,?,?,?,?)", (uid, "2026-01-01", "q", 1, 0, 1, 1, 0, 0)),
        ("INSERT INTO user_achievements VALUES (?,?,?)", (uid, "a1", now)),
        ("INSERT INTO leaderboard VALUES (?,?,?,?,?,?,?,?)", ("2026-01-01", "t", "hard", uid, "n", "A", 90, 50)),
        ("INSERT INTO reward_events (user_id, kind, xp, coins, idempotency_key, created_at) VALUES (?,?,?,?,?,?)", (uid, "quiz_complete", 5, 1, f"k{uid}", now)),
        ("INSERT INTO quizzes (id, user_id, session_id, topic, question_type, questions_json, question_count, created_at) VALUES (?,?,?,?,?,?,?,?)", (f"q{uid}", uid, "s", "t", "MCQ", "[]", 0, now)),
        ("INSERT INTO quiz_answers (quiz_id, question_id, answer, correct, answered_at) VALUES (?,?,?,?,?)", (f"q{uid}", 1, "a", 1, now)),
        ("INSERT INTO arena_battles (id, user_id, session_id, doc_hash, topic, difficulty, board_key, boss_json, boss_hp, boss_max_hp, "
         "player_hp, player_max_hp, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
         (f"b{uid}", uid, "s", "h", "t", "hard", "t|hard|h", "{}", 1, 1, 1, 1, now, now)),
        ("INSERT INTO arena_questions (battle_id, seq, phase, concept_key, text_key, question_json) VALUES (?,?,?,?,?,?)",
         (f"b{uid}", 1, 1, "c", "q", "{}")),
        ("INSERT INTO arena_scores (battle_id, board_key, user_id, username, topic, topic_key, difficulty, doc_hash, grade, accuracy, "
         "time_seconds, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (f"b{uid}", "t|hard|h", uid, "n", "t", "t", "hard", "h", "A", 90, 50, now)),
        ("INSERT INTO arena_personal_bests (user_id, board_key, battle_id, grade, accuracy, time_seconds, updated_at) VALUES (?,?,?,?,?,?,?)",
         (uid, "t|hard|h", f"b{uid}", "A", 90, 50, now)),
        ("INSERT INTO arena_runs (id, user_id, session_id, doc_hash, difficulty, seed, acts_json, map_json, hearts, max_hearts, "
         "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (f"r{uid}", uid, "s", "h", "hard", 1, "[]", "[]", 10, 10, now, now)),
        ("INSERT INTO concept_mastery (user_id, doc_hash, concept_key, concept, last_seen_at) VALUES (?,?,?,?,?)",
         (uid, "h", "c", "C", now)),
        ("INSERT INTO missed_questions (user_id, doc_hash, text_key, concept_key, concept, source, question, correct_answer, "
         "missed_at) VALUES (?,?,?,?,?,?,?,?,?)", (uid, "h", "q", "c", "C", "arena", "Q?", "A", now)),
    ]:
        c.execute(sql, args)


def test_deleting_a_user_cascades_to_every_table_and_nothing_else(tmp_path):
    db = tmp_path / "x.db"
    migrate(db)
    c = connect(db)
    a, b = _insert_user(c, 1), _insert_user(c, 2)
    _fill_every_per_user_table(c, a)
    _fill_every_per_user_table(c, b)
    c.commit()
    c.execute("DELETE FROM users WHERE id = ?", (a,))
    c.commit()
    for t in PER_USER_TABLES:
        assert c.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = ?", (a,)).fetchone()[0] == 0, t
        assert c.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = ?", (b,)).fetchone()[0] == 1, t   # others untouched
    assert c.execute("SELECT COUNT(*) FROM quiz_answers WHERE quiz_id = ?", (f"q{a}",)).fetchone()[0] == 0   # answers go with their quiz
    assert c.execute("SELECT COUNT(*) FROM quiz_answers WHERE quiz_id = ?", (f"q{b}",)).fetchone()[0] == 1
    assert c.execute("SELECT COUNT(*) FROM arena_questions WHERE battle_id = ?", (f"b{a}",)).fetchone()[0] == 0   # questions go with their battle
    assert c.execute("SELECT COUNT(*) FROM arena_questions WHERE battle_id = ?", (f"b{b}",)).fetchone()[0] == 1
    assert c.execute("SELECT COUNT(*) FROM achievements").fetchone()[0] == 1                           # catalogue survives


def test_rows_for_a_nonexistent_user_are_rejected(tmp_path):
    db = tmp_path / "x.db"
    migrate(db)
    c = connect(db)
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        c.execute("INSERT INTO user_progress (user_id, created_at, updated_at) VALUES (999,'t','t')")


# ── startup wiring ────────────────────────────────────────────────────────────
def test_startup_refuses_unmerged_legacy_files_and_names_the_fix(tmp_path):
    for n in ("app.db", "progression.db"):
        sqlite3.connect(tmp_path / n).close()
    with pytest.raises(LegacyDatabaseError, match=r"scripts/merge_legacy_dbs\.py"):
        upgrade(tmp_path / DATABASE_FILENAME)
    assert not (tmp_path / DATABASE_FILENAME).exists()               # nothing was created behind the user's back
    (tmp_path / DATABASE_FILENAME).touch()                           # once coursemate.db exists the old files are ignored
    assert upgrade(tmp_path / DATABASE_FILENAME) == [1, 2, 3, 4, 5, 6, 7]


def test_app_uses_one_database_file(app_module):
    import state
    from config import settings
    assert state.db.db_path == state.store.db_path == str(settings.database_path)
    assert settings.database_path.name == DATABASE_FILENAME
    assert {p.name for p in settings.data_dir.glob("*.db")} == {DATABASE_FILENAME}


def test_schema_is_only_ever_created_by_migrations():
    """No CREATE/ALTER/DROP anywhere else (import time or request paths), and one place opens connections."""
    ddl = re.compile(r"\b(CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)|ALTER\s+TABLE|DROP\s+TABLE)\b", re.I)
    ddl_allowed = {"database/migrate.py"}        # creates only its own schema_migrations bookkeeping table
    connect_allowed = {"database/connection.py"}
    ddl_offenders, connect_offenders = [], []
    for p in BACKEND.rglob("*.py"):
        rel = p.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "scripts/", ".venv/", "venv/", "static/")):
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        if ddl.search(text) and rel not in ddl_allowed:
            ddl_offenders.append(rel)
        if "sqlite3.connect(" in text and rel not in connect_allowed:
            connect_offenders.append(rel)
    assert not ddl_offenders, f"schema changes belong in backend/migrations: {ddl_offenders}"
    assert not connect_offenders, f"open connections via database.connection.connect(): {connect_offenders}"


# ── upgrade from the old two files ────────────────────────────────────────────
OLD_APP_DDL = """
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, last_login TIMESTAMP,
  api_key_encrypted TEXT, llm_provider TEXT DEFAULT 'mistral', llm_model TEXT, llm_base_url TEXT);
CREATE UNIQUE INDEX idx_users_username ON users(username);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id));
CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, session_id TEXT NOT NULL,
  mode TEXT NOT NULL, action_type TEXT NOT NULL, content TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id));
"""
OLD_PROG_DDL = """
CREATE TABLE user_progress (user_id TEXT PRIMARY KEY, total_xp INTEGER NOT NULL DEFAULT 0, current_level INTEGER NOT NULL DEFAULT 1,
  coins INTEGER NOT NULL DEFAULT 0, streak_days INTEGER NOT NULL DEFAULT 0, last_active_utc DATE, streak_freezes INTEGER NOT NULL DEFAULT 0,
  total_arena_rounds INTEGER NOT NULL DEFAULT 0, total_bosses_defeated INTEGER NOT NULL DEFAULT 0, total_quizzes_completed INTEGER NOT NULL DEFAULT 0,
  total_chat_questions INTEGER NOT NULL DEFAULT 0, total_chat_bundles INTEGER NOT NULL DEFAULT 0, total_notes_generated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  total_flashcards_studied INTEGER NOT NULL DEFAULT 0, best_quiz_accuracy INTEGER NOT NULL DEFAULT 0, nightmare_bosses_defeated INTEGER NOT NULL DEFAULT 0);
CREATE TABLE user_avatar (user_id TEXT PRIMARY KEY, equipped_json TEXT NOT NULL DEFAULT '{}', owned_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES user_progress(user_id));
CREATE TABLE daily_action_counts (user_id TEXT NOT NULL, action_date_utc DATE NOT NULL, action_type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0, last_ts_utc TEXT, PRIMARY KEY(user_id, action_date_utc, action_type));
CREATE TABLE daily_quests (user_id TEXT NOT NULL, quest_date_utc DATE NOT NULL, quest_type TEXT NOT NULL, target_count INTEGER NOT NULL,
  current_count INTEGER NOT NULL DEFAULT 0, reward_xp INTEGER NOT NULL, reward_coins INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, quest_date_utc, quest_type));
CREATE TABLE achievements (achievement_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, unlock_type TEXT NOT NULL,
  unlock_threshold INTEGER NOT NULL, reward_xp INTEGER NOT NULL DEFAULT 0, reward_coins INTEGER NOT NULL DEFAULT 0,
  reward_cosmetic_id TEXT, tier TEXT NOT NULL DEFAULT 'common');
CREATE TABLE user_achievements (user_id TEXT NOT NULL, achievement_id TEXT NOT NULL, unlocked_at_utc TEXT NOT NULL,
  PRIMARY KEY(user_id, achievement_id), FOREIGN KEY(user_id) REFERENCES user_progress(user_id),
  FOREIGN KEY(achievement_id) REFERENCES achievements(achievement_id));
CREATE TABLE user_buffs (user_id TEXT PRIMARY KEY, buffs_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
CREATE TABLE user_inventory (user_id TEXT NOT NULL, item_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id, item_id));
CREATE TABLE leaderboard (date TEXT NOT NULL, topic TEXT NOT NULL, difficulty TEXT NOT NULL, user_id TEXT NOT NULL, username TEXT NOT NULL,
  grade TEXT, accuracy INTEGER DEFAULT 0, time_seconds INTEGER DEFAULT 9999, PRIMARY KEY (date, topic, difficulty, user_id));
"""


def make_legacy_install(folder: Path, *, with_orphans: bool) -> dict:
    """Build app.db + progression.db the way the old code did (TEXT user ids, FKs not enforced)."""
    folder.mkdir(parents=True, exist_ok=True)
    a = sqlite3.connect(folder / "app.db")
    a.executescript(OLD_APP_DDL)
    for uid in (1, 3, 4):                                                   # id 2 was deleted long ago
        a.execute("INSERT INTO users (id, email, username, full_name, password_hash, llm_provider) VALUES (?,?,?,?,?,?)",
                  (uid, f"u{uid}@x.io", f"user{uid}", f"User {uid}", "hash", "gemini" if uid == 1 else "mistral"))
    a.execute("INSERT INTO users (id, email, username, full_name, password_hash) VALUES (9,'u9@x.io','user9','U9','h')")
    a.execute("DELETE FROM users WHERE id = 9")                              # AUTOINCREMENT counter now sits at 9
    for i, uid in enumerate((1, 1, 3, 4)):
        a.execute("INSERT INTO activity_log (user_id, session_id, mode, action_type, content) VALUES (?,?,?,?,?)",
                  (uid, f"s{i}", "chat", "question", f"q{i}"))
    a.execute("INSERT INTO sessions (id, user_id, expires_at) VALUES ('tok1', 1, '2030-01-01')")
    if with_orphans:
        a.execute("INSERT INTO activity_log (user_id, session_id, mode, action_type) VALUES (2,'gone','chat','q')")
    a.commit(); a.close()

    p = sqlite3.connect(folder / "progression.db")
    p.executescript(OLD_PROG_DDL)
    now = "2026-01-01T00:00:00Z"
    p.execute("INSERT INTO achievements VALUES ('first','First','d','quiz',1,10,5,NULL,'common')")
    ids = ["1", "3", "4"] + (["2", "legacyname"] if with_orphans else [])
    for uid in ids:
        p.execute("INSERT INTO user_progress (user_id, total_xp, coins, best_quiz_accuracy, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                  (uid, 100 * len(uid), 7, 88, now, now))
        p.execute("INSERT INTO user_avatar (user_id, equipped_json, created_at, updated_at) VALUES (?,?,?,?)",
                  (uid, '{"title":"hero"}', now, now))
        p.execute("INSERT INTO daily_action_counts (user_id, action_date_utc, action_type, count) VALUES (?,?,?,?)", (uid, "2026-01-01", "chat", 3))
        p.execute("INSERT INTO daily_quests VALUES (?,?,?,?,?,?,?,?,?)", (uid, "2026-01-01", "chat_5", 5, 2, 20, 10, 0, 0))
        p.execute("INSERT INTO user_achievements VALUES (?,?,?)", (uid, "first", now))
    p.execute("INSERT INTO user_buffs VALUES ('1','{\"xp\":2}',?)", (now,))
    p.execute("INSERT INTO user_inventory VALUES ('1','potion',3)")
    p.execute("INSERT INTO leaderboard VALUES ('2026-01-01','mitosis','hard','1','user1','A',95,40)")
    p.commit(); p.close()
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.glob("*.db")}


def _counts(db_path):
    c = sqlite3.connect(db_path)
    return {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in sorted(ALL_TABLES - {"schema_migrations"})}


def test_upgrade_keeps_every_row_and_ends_on_the_same_schema_as_a_fresh_install(tmp_path):
    shas = make_legacy_install(tmp_path / "data", with_orphans=False)
    res = merge_script.merge(tmp_path / "data", log=lambda *_: None)

    assert res.originals_untouched and not res.orphan_report
    assert shas == {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (tmp_path / "data").glob("*.db")
                    if p.name != DATABASE_FILENAME}
    assert sorted(p.name for p in (tmp_path / "data").iterdir()) == ["app.db", "coursemate.db", "progression.db"]   # no -wal/-shm/partial left

    # row counts: old files -> new file
    old_a, old_p = sqlite3.connect(tmp_path / "data" / "app.db"), sqlite3.connect(tmp_path / "data" / "progression.db")
    new = _counts(res.target)
    for t in ("users", "sessions", "activity_log"):
        assert new[t] == old_a.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0], t
    for t in ("achievements", "user_progress", "user_avatar", "user_buffs", "user_inventory", "daily_action_counts",
              "daily_quests", "user_achievements", "leaderboard"):
        assert new[t] == old_p.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0], t
    assert all(r.ok for r in res.tables)

    # the old files had no ledger: every existing balance became an opening event (cache == SUM(events))
    c0 = sqlite3.connect(res.target)
    assert c0.execute("SELECT COUNT(*) FROM reward_events WHERE kind = 'opening_balance'").fetchone()[0] == 3
    assert c0.execute("SELECT SUM(xp), SUM(coins) FROM reward_events").fetchone() \
        == c0.execute("SELECT SUM(total_xp), SUM(coins) FROM user_progress").fetchone()
    c0.close()

    # fresh install and upgrade reach exactly the same schema
    fresh = tmp_path / "fresh.db"
    migrate(fresh)
    assert signature(res.target) == signature(fresh)

    # user_id is INTEGER everywhere now, values preserved
    c = sqlite3.connect(res.target)
    for t in PER_USER_TABLES:
        assert c.execute(f"SELECT DISTINCT typeof(user_id) FROM {t}").fetchall() in ([("integer",)], []), t
    assert c.execute("SELECT user_id, total_xp, best_quiz_accuracy FROM user_progress ORDER BY user_id").fetchall() \
        == [(1, 100, 88), (3, 100, 88), (4, 100, 88)]
    assert c.execute("SELECT llm_provider FROM users WHERE id=1").fetchone()[0] == "gemini"      # data copied as-is
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []
    # deleted ids are never re-issued
    cc = connect(res.target)
    cc.execute("INSERT INTO users (email, username, full_name, password_hash) VALUES ('n@x.io','n','N','h')")
    assert cc.execute("SELECT last_insert_rowid()").fetchone()[0] == 10
    # and the migrated data is under the new rules: deleting a user cascades
    cc.execute("DELETE FROM users WHERE id = 1")
    cc.commit()
    assert all(cc.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = 1").fetchone()[0] == 0 for t in PER_USER_TABLES)
    assert upgrade(res.target) == []                                  # the app's startup sees a fully migrated DB


def test_orphan_rows_need_explicit_consent_and_are_reported_not_lost(tmp_path):
    shas = make_legacy_install(tmp_path / "data", with_orphans=True)
    with pytest.raises(merge_script.OrphansFound) as e:
        merge_script.merge(tmp_path / "data", log=lambda *_: None)
    assert "legacyname" in str(e.value) and "user id 2 has no row in users" in str(e.value)
    assert sorted(p.name for p in (tmp_path / "data").iterdir()) == ["app.db", "progression.db"]   # nothing written

    res = merge_script.merge(tmp_path / "data", allow_orphans=True, log=lambda *_: None)
    by = {r.name: r for r in res.tables}
    assert (by["activity_log"].source_rows, by["activity_log"].migrated, len(by["activity_log"].excluded)) == (5, 4, 1)
    assert (by["user_progress"].source_rows, by["user_progress"].migrated, len(by["user_progress"].excluded)) == (5, 3, 2)
    assert all(r.ok for r in res.tables)                              # source = migrated + excluded, new db = migrated
    report = json.loads(res.orphan_report.read_text(encoding="utf-8"))
    assert {r["user_id"] for r in report["user_progress"]} == {"2", "legacyname"}              # full rows kept in the report
    assert shas == {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (tmp_path / "data").glob("*.db")
                    if p.name != DATABASE_FILENAME}


def test_merge_refuses_to_overwrite_an_existing_database(tmp_path):
    make_legacy_install(tmp_path / "data", with_orphans=False)
    (tmp_path / "data" / DATABASE_FILENAME).write_bytes(b"precious")
    with pytest.raises(merge_script.MergeError, match="already exists"):
        merge_script.merge(tmp_path / "data", log=lambda *_: None)
    assert (tmp_path / "data" / DATABASE_FILENAME).read_bytes() == b"precious"


def test_user_ids_stay_strings_above_the_database_layer(make_user):
    """user_id is INTEGER in SQLite, but API responses and caches have always carried it as a string."""
    import state
    c, uid = make_user()
    assert state.store.get_progress(str(uid))["user_id"] == str(uid)
    assert state.store.get_avatar(str(uid))["user_id"] == str(uid)
    assert c.get("/profile").json()["progress"]["user_id"] == str(uid)
    assert state.db.get_user_by_id(uid)["id"] == uid                 # the users table itself is unchanged
