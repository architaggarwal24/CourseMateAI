"""Versioned schema migrations: numbered .sql files in backend/migrations/.

    migrations/0001_initial.sql      -> version 1
    migrations/0002_add_foo.sql      -> version 2   (future changes go here, never edit an applied file)

`upgrade(path)` is what the app calls at startup. It applies every migration that is not recorded
yet, each one atomically (all of its statements and its bookkeeping row commit together, or
nothing does), and records name + checksum in `schema_migrations`.

The schema is changed ONLY by migrations - no CREATE TABLE / ALTER TABLE runs on request paths
or at import time.
"""
import hashlib
import logging
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Union

from database import pg
from database.connection import connect

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
# PostgreSQL (DATABASE_URL): a baseline equal to SQLite's schema at that version, then numbered twins of every
# later SQLite migration (scripts/postgres_schema.py writes the baseline; docs/postgres.md).
PG_MIGRATIONS_DIR = MIGRATIONS_DIR / "postgres"
_PG_LOCK = 7_420_314_001                    # pg_advisory_lock key: one migrator at a time across processes
DATABASE_FILENAME = "coursemate.db"
# The two files this single database replaced (see scripts/merge_legacy_dbs.py).
LEGACY_FILENAMES = ("app.db", "progression.db")

_FILE_RE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")


class MigrationError(RuntimeError):
    """The migration files and the database disagree, or a migration failed."""


class LegacyDatabaseError(MigrationError):
    """Old app.db / progression.db exist but have not been merged into coursemate.db yet."""


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    sql: str
    checksum: str


def _checksum(sql: str) -> str:
    # Hash line-ending-normalised text so a Windows (CRLF) checkout matches a Linux one.
    return hashlib.sha256(sql.replace("\r\n", "\n").encode("utf-8")).hexdigest()


def discover(directory: Union[str, Path] = MIGRATIONS_DIR) -> List[Migration]:
    """Read and validate the numbered migration files (versions must be 1, 2, 3 ... with no gaps)."""
    found: List[Migration] = []
    for path in sorted(Path(directory).glob("*.sql")):
        m = _FILE_RE.match(path.name)
        if not m:
            raise MigrationError(f"Migration file {path.name!r} must be named NNNN_description.sql")
        sql = path.read_text(encoding="utf-8")
        found.append(Migration(int(m.group(1)), m.group(2), sql, _checksum(sql)))
    versions = [mig.version for mig in found]
    if versions != list(range(1, len(versions) + 1)):
        raise MigrationError(f"Migration versions must be consecutive starting at 1, found {versions}")
    return found


def _applied(conn: sqlite3.Connection) -> dict:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
               version    INTEGER PRIMARY KEY,
               name       TEXT NOT NULL,
               checksum   TEXT NOT NULL,
               applied_at TEXT NOT NULL
           )"""
    )
    conn.commit()
    return {r["version"]: r["checksum"] for r in conn.execute("SELECT version, checksum FROM schema_migrations")}


def _apply(conn: sqlite3.Connection, mig: Migration) -> None:
    # executescript() commits any open transaction first, so the transaction lives INSIDE the
    # script: DDL + bookkeeping row + COMMIT. SQLite DDL is transactional, so a failure rolls it all back.
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    script = (
        "BEGIN IMMEDIATE;\n"
        f"{mig.sql}\n;\n"
        "INSERT INTO schema_migrations (version, name, checksum, applied_at) "
        f"VALUES ({mig.version}, '{mig.name}', '{mig.checksum}', '{stamp}');\n"
        "COMMIT;"
    )
    try:
        conn.executescript(script)
    except sqlite3.Error:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise


def discover_pg(directory: Union[str, Path] = PG_MIGRATIONS_DIR) -> List[Migration]:
    """The PostgreSQL files: NNNN_baseline.sql first, then consecutive versions after it."""
    found: List[Migration] = []
    for path in sorted(Path(directory).glob("*.sql")):
        m = _FILE_RE.match(path.name)
        if not m:
            raise MigrationError(f"Migration file {path.name!r} must be named NNNN_description.sql")
        sql = path.read_text(encoding="utf-8")
        found.append(Migration(int(m.group(1)), m.group(2), sql, _checksum(sql)))
    if not found or found[0].name != "baseline":
        raise MigrationError(f"{directory} must start with an NNNN_baseline.sql (scripts/postgres_schema.py writes it)")
    versions = [mig.version for mig in found]
    if versions != list(range(versions[0], versions[0] + len(versions))):
        raise MigrationError(f"PostgreSQL migration versions must be consecutive after the baseline, found {versions}")
    return found


def _migrate_pg(url: str, directory: Union[str, Path]) -> List[int]:
    migrations = discover_pg(directory)
    conn = connect(url)
    raw = conn._c                                            # the psycopg connection (autocommit)
    applied_now: List[int] = []
    try:
        raw.execute("SELECT pg_advisory_lock(%s)", (_PG_LOCK,))
        raw.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version BIGINT PRIMARY KEY, name TEXT NOT NULL, "
                    "checksum TEXT NOT NULL, applied_at TEXT NOT NULL)")
        done = {r["version"]: r["checksum"] for r in raw.execute("SELECT version, checksum FROM schema_migrations").fetchall()}
        unknown = sorted(set(done) - {m.version for m in migrations})
        if unknown:
            raise MigrationError(f"The database was migrated to version(s) {unknown} which this code does not know about "
                                 "- it was created by a newer version of the app.")
        for mig in migrations:
            if mig.version in done and done[mig.version] != mig.checksum:
                raise MigrationError(f"PostgreSQL migration {mig.version:04d}_{mig.name}.sql was changed after it was "
                                     "applied. Never edit an applied migration - add a new numbered one instead.")
        baseline = migrations[0]
        if done and baseline.version not in done:
            raise MigrationError("The database has migrations recorded but not the baseline: it wasn't made by this app.")
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for mig in migrations:
            if mig.version in done:
                continue
            try:
                with raw.transaction():                       # DDL is transactional in PostgreSQL: all or nothing
                    raw.execute(mig.sql)
                    raw.execute("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (%s, %s, %s, %s)",
                                (mig.version, mig.name, mig.checksum, stamp))
            except Exception as exc:
                raise MigrationError(f"PostgreSQL migration {mig.version:04d}_{mig.name}.sql failed: {exc}") from exc
            applied_now.append(mig.version)
            logger.info("Applied PostgreSQL migration %04d_%s", mig.version, mig.name)
        return applied_now
    finally:
        try:
            raw.execute("SELECT pg_advisory_unlock(%s)", (_PG_LOCK,))
        finally:
            conn.close()


def migrate(path: Union[str, Path], directory: Union[str, Path] = MIGRATIONS_DIR) -> List[int]:
    """Bring the database at `path` (created if missing) up to the latest version. Returns the versions applied.
    A postgresql:// URL is migrated from migrations/postgres/ instead."""
    if pg.is_url(path):
        return _migrate_pg(str(path), PG_MIGRATIONS_DIR if Path(directory) == MIGRATIONS_DIR else directory)
    migrations = discover(directory)
    conn = connect(path)
    applied_now: List[int] = []
    try:
        done = _applied(conn)

        unknown = sorted(set(done) - {m.version for m in migrations})
        if unknown:
            raise MigrationError(
                f"{path} was migrated to version(s) {unknown} which this code does not know about "
                "- it was created by a newer version of the app."
            )
        for mig in migrations:
            if mig.version in done and done[mig.version] != mig.checksum:
                raise MigrationError(
                    f"Migration {mig.version:04d}_{mig.name}.sql was changed after it was applied to {path}. "
                    "Never edit an applied migration - add a new numbered one instead."
                )

        for mig in migrations:
            if mig.version in done:
                continue
            try:
                _apply(conn, mig)
            except sqlite3.Error as exc:
                # Another process (e.g. a second worker) may have applied it between our check and our lock.
                if mig.version in _applied(conn):
                    continue
                raise MigrationError(f"Migration {mig.version:04d}_{mig.name}.sql failed: {exc}") from exc
            applied_now.append(mig.version)
            logger.info("Applied migration %04d_%s", mig.version, mig.name)
        return applied_now
    finally:
        conn.close()


def legacy_files(directory: Union[str, Path]) -> List[Path]:
    return [p for p in (Path(directory) / n for n in LEGACY_FILENAMES) if p.exists()]


def upgrade(path: Union[str, Path], migrations_dir: Optional[Union[str, Path]] = None) -> List[int]:
    """Startup entry point: refuse to start on an un-merged legacy install, then migrate.

    Starting with a brand-new empty coursemate.db next to existing app.db / progression.db would make
    every account and score look lost, so that situation is an error with the exact fix in the message."""
    if pg.is_url(path):
        return migrate(str(path), migrations_dir or MIGRATIONS_DIR)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    old = legacy_files(path.parent)
    if old and not path.exists():
        names = ", ".join(p.name for p in old)
        raise LegacyDatabaseError(
            f"Found the old database file(s) {names} in {path.parent} but no {path.name}.\n"
            "The two SQLite files were replaced by one database. Move your data over once with:\n"
            "    python scripts/merge_legacy_dbs.py            (run from the backend/ folder)\n"
            "It leaves the old files untouched; see its --help for the options."
        )
    return migrate(path, migrations_dir or MIGRATIONS_DIR)
