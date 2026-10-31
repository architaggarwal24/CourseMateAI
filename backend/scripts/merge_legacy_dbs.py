"""One-off: merge the old app.db + progression.db into the single data/coursemate.db.

    python scripts/merge_legacy_dbs.py                  # from backend/; --data-dir to point elsewhere
    python scripts/merge_legacy_dbs.py --allow-orphans  # accept excluding rows that belong to no user (see below)

What it does
  * Builds a NEW coursemate.db from migrations/ (exactly the schema a fresh install gets), copies
    every row from both old files into it, then verifies the result.
  * The old files are NEVER opened by SQLite: they are byte-copied to a temp folder and read from
    the copies. Their SHA-256 is checked before and after to prove they are untouched.
  * user_id was INTEGER in app.db but TEXT in the progression tables; everything becomes INTEGER.
  * The new file is built as coursemate.db.partial and renamed into place only after every check
    passes, so a failed run leaves nothing behind. It refuses to run if coursemate.db already exists.

Rows that cannot be migrated ("orphans")
  The new schema enforces FOREIGN KEY (user_id) REFERENCES users(id), so a row whose user_id is not
  an existing user (e.g. an account deleted before deletion cleaned up properly, or a progression
  row keyed by a username instead of a numeric id) has no valid home. The script lists them and stops
  unless you pass --allow-orphans; with it they are written in full to data/legacy-orphans-<time>.json
  and the row-count check becomes:   source rows = migrated rows + excluded rows.

Exit status: 0 done, 1 error, 2 orphans found and --allow-orphans not given (nothing was written).
"""
import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from database.connection import connect  # noqa: E402
from database.migrate import DATABASE_FILENAME, migrate  # noqa: E402


@dataclass(frozen=True)
class Table:
    name: str
    source: str                   # "app" -> app.db, "prog" -> progression.db
    user_kind: Optional[str]      # None | "int" (INTEGER user_id already) | "text" (TEXT user_id -> INTEGER)
    pk: tuple                     # ordering / identity columns


# Parents first: foreign keys are enforced while copying.
TABLES = [
    Table("users", "app", None, ("id",)),
    Table("sessions", "app", "int", ("id",)),
    Table("activity_log", "app", "int", ("id",)),
    Table("achievements", "prog", None, ("achievement_id",)),
    Table("user_progress", "prog", "text", ("user_id",)),
    Table("user_avatar", "prog", "text", ("user_id",)),
    Table("user_buffs", "prog", "text", ("user_id",)),
    Table("user_inventory", "prog", "text", ("user_id", "item_id")),
    Table("daily_action_counts", "prog", "text", ("user_id", "action_date_utc", "action_type")),
    Table("daily_quests", "prog", "text", ("user_id", "quest_date_utc", "quest_type")),
    Table("user_achievements", "prog", "text", ("user_id", "achievement_id")),
    Table("leaderboard", "prog", "text", ("date", "topic", "difficulty", "user_id")),
]
AUTOINCREMENT_TABLES = ("users", "activity_log")


class MergeError(RuntimeError):
    pass


class OrphansFound(MergeError):
    pass


@dataclass
class TableReport:
    name: str
    source_rows: int = 0
    migrated: int = 0
    excluded: List[dict] = field(default_factory=list)
    in_new_db: int = 0
    digest_ok: bool = True

    @property
    def ok(self) -> bool:
        return (self.source_rows == self.migrated + len(self.excluded)
                and self.in_new_db == self.migrated and self.digest_ok)


@dataclass
class MergeResult:
    target: Path
    tables: List[TableReport]
    orphan_report: Optional[Path]
    originals_untouched: bool


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _cols(conn: sqlite3.Connection, schema: str, table: str) -> List[sqlite3.Row]:
    return conn.execute(f"PRAGMA {schema}.table_info({table})").fetchall()


def _has_table(conn: sqlite3.Connection, schema: str, table: str) -> bool:
    return bool(_cols(conn, schema, table))


def _valid_user(table: Table) -> str:
    """SQL predicate (rows aliased `s`) selecting rows whose user id is an existing user."""
    if table.user_kind is None:
        return "1"
    if table.user_kind == "int":
        return "s.user_id IN (SELECT id FROM main.users)"
    return ("CAST(s.user_id AS INTEGER) IN (SELECT id FROM main.users) "
            "AND CAST(CAST(s.user_id AS INTEGER) AS TEXT) = CAST(s.user_id AS TEXT)")


def _expr(table: Table, col: str) -> str:
    return "CAST(s.user_id AS INTEGER)" if (col == "user_id" and table.user_kind == "text") else f"s.{col}"


def _reason(raw_user_id, valid_ids: set) -> str:
    text = str(raw_user_id)
    if not (text.lstrip("-").isdigit() and str(int(text)) == text):
        return f"non-numeric user id {text!r}"
    return f"user id {text} has no row in users"


def merge(data_dir: Path, *, allow_orphans: bool = False, log: Callable[[str], None] = print) -> MergeResult:
    data_dir = Path(data_dir)
    target = data_dir / DATABASE_FILENAME
    partial = data_dir / (DATABASE_FILENAME + ".partial")
    old = {"app": data_dir / "app.db", "prog": data_dir / "progression.db"}
    present = {k: p for k, p in old.items() if p.exists()}

    if target.exists():
        raise MergeError(f"{target} already exists - refusing to overwrite it. Move it away to run the merge again.")
    if not present:
        raise MergeError(f"Neither {old['app'].name} nor {old['prog'].name} found in {data_dir}")

    before = {p: _sha256(p) for p in present.values()}

    with tempfile.TemporaryDirectory(prefix="coursemate-merge-") as tmp:
        # Read copies, never the originals (also picks up -wal/-shm so uncheckpointed data is included).
        copies: Dict[str, Path] = {}
        for key, path in present.items():
            for sidecar in (path, Path(str(path) + "-wal"), Path(str(path) + "-shm")):
                if sidecar.exists():
                    shutil.copy2(sidecar, Path(tmp) / sidecar.name)
            copies[key] = Path(tmp) / path.name

        for stale in (partial, Path(str(partial) + "-wal"), Path(str(partial) + "-shm")):
            if stale.exists():
                stale.unlink()
        migrate(partial)                                   # the same migrations a fresh install runs
        conn = connect(partial)
        reports: List[TableReport] = []
        try:
            for key, path in copies.items():
                conn.execute(f"ATTACH DATABASE ? AS old_{key}", (str(path),))
            reports = _copy_all(conn, present.keys())
            _opening_balances(conn)
            orphans = [r for r in reports if r.excluded]
            if orphans and not allow_orphans:
                conn.rollback()
                raise OrphansFound(_orphan_summary(orphans))
            conn.commit()
            _carry_autoincrement(conn, present.keys())
            conn.commit()
            _verify(conn, reports, present.keys())
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except BaseException:
            conn.close()
            for p in (partial, Path(str(partial) + "-wal"), Path(str(partial) + "-shm")):
                if p.exists():
                    p.unlink()
            raise
        conn.close()

    orphan_report = None
    orphans = [r for r in reports if r.excluded]
    if orphans:
        orphan_report = data_dir / f"legacy-orphans-{time.strftime('%Y%m%d-%H%M%S')}.json"
        orphan_report.write_text(
            json.dumps({r.name: r.excluded for r in orphans}, indent=2, default=str), encoding="utf-8")

    for sidecar in (Path(str(partial) + "-wal"), Path(str(partial) + "-shm")):
        if sidecar.exists():
            sidecar.unlink()
    os.replace(partial, target)

    after = {p: _sha256(p) for p in present.values()}
    return MergeResult(target, reports, orphan_report, after == before)


def _copy_all(conn: sqlite3.Connection, keys) -> List[TableReport]:
    reports: List[TableReport] = []
    for table in TABLES:
        report = TableReport(table.name)
        reports.append(report)
        schema = f"old_{table.source}"
        if table.source not in keys or not _has_table(conn, schema, table.name):
            continue                                       # that old file/table never existed: nothing to copy

        target_cols = _cols(conn, "main", table.name)
        source_cols = {c["name"] for c in _cols(conn, schema, table.name)}
        shared = [c["name"] for c in target_cols if c["name"] in source_cols]
        missing = [c["name"] for c in target_cols
                   if c["name"] not in source_cols and c["notnull"] and c["dflt_value"] is None and not c["pk"]]
        if missing:
            raise MergeError(f"{schema}.{table.name} lacks required column(s) {missing}; "
                             "open it once with the previous app version so its own migrations run, then retry.")

        report.source_rows = conn.execute(f"SELECT COUNT(*) FROM {schema}.{table.name}").fetchone()[0]
        select = ", ".join(_expr(table, c) for c in shared)
        cur = conn.execute(
            f"INSERT INTO main.{table.name} ({', '.join(shared)}) "
            f"SELECT {select} FROM {schema}.{table.name} s WHERE {_valid_user(table)} ORDER BY s.rowid"
        )
        report.migrated = cur.rowcount
        if report.source_rows != report.migrated:
            valid_ids = {r[0] for r in conn.execute("SELECT id FROM main.users")}
            bad = conn.execute(
                f"SELECT s.* FROM {schema}.{table.name} s WHERE NOT ({_valid_user(table)}) ORDER BY s.rowid").fetchall()
            for row in bad:
                d = dict(row)
                d["_reason"] = _reason(d.get("user_id"), valid_ids)
                report.excluded.append(d)
    return reports


def _opening_balances(conn: sqlite3.Connection) -> None:
    """The old files had no reward ledger: record each user's existing XP / coins as one opening event, so
    the cached totals equal SUM(reward_events) from the start (same as migration 0004 does for existing data)."""
    conn.execute(
        "INSERT INTO main.reward_events (user_id, kind, xp, coins, source_id, idempotency_key, created_at) "
        "SELECT user_id, 'opening_balance', total_xp, coins, NULL, 'opening_balance:' || user_id, created_at "
        "FROM main.user_progress WHERE total_xp <> 0 OR coins <> 0")


def _carry_autoincrement(conn: sqlite3.Connection, keys) -> None:
    """Deleted rows must not have their ids handed out again: keep the old AUTOINCREMENT high-water marks."""
    if "app" not in keys or not _has_table(conn, "old_app", "sqlite_sequence"):
        return
    for name in AUTOINCREMENT_TABLES:
        row = conn.execute("SELECT seq FROM old_app.sqlite_sequence WHERE name = ?", (name,)).fetchone()
        if not row:
            continue
        if conn.execute("UPDATE main.sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?", (row[0], name)).rowcount == 0:
            conn.execute("INSERT INTO main.sqlite_sequence (name, seq) VALUES (?, ?)", (name, row[0]))


def _digest(rows) -> str:
    h = hashlib.sha256()
    for r in rows:
        h.update(repr(tuple(r)).encode("utf-8"))
    return h.hexdigest()


def _verify(conn: sqlite3.Connection, reports: List[TableReport], keys) -> None:
    for table, report in zip(TABLES, reports):
        report.in_new_db = conn.execute(f"SELECT COUNT(*) FROM main.{table.name}").fetchone()[0]
        schema = f"old_{table.source}"
        if table.source in keys and _has_table(conn, schema, table.name):
            shared = [c["name"] for c in _cols(conn, "main", table.name)
                      if c["name"] in {x["name"] for x in _cols(conn, schema, table.name)}]
            order = ", ".join(_expr(table, c) for c in table.pk)
            src = conn.execute(
                f"SELECT {', '.join(_expr(table, c) for c in shared)} FROM {schema}.{table.name} s "
                f"WHERE {_valid_user(table)} ORDER BY {order}")
            dst = conn.execute(
                f"SELECT {', '.join(shared)} FROM main.{table.name} ORDER BY {', '.join(table.pk)}")
            report.digest_ok = _digest(src) == _digest(dst)         # every migrated row's content is identical
    bad = [r.name for r in reports if not r.ok]
    if bad:
        raise MergeError(f"Verification failed for: {', '.join(bad)}")
    if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise MergeError("PRAGMA integrity_check failed on the new database")
    violations = conn.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise MergeError(f"{len(violations)} foreign key violation(s) in the new database")
    for name in AUTOINCREMENT_TABLES:
        old = conn.execute("SELECT seq FROM old_app.sqlite_sequence WHERE name = ?", (name,)).fetchone() \
            if "app" in keys and _has_table(conn, "old_app", "sqlite_sequence") else None
        new = conn.execute("SELECT seq FROM main.sqlite_sequence WHERE name = ?", (name,)).fetchone()
        if old and (not new or new[0] < old[0]):
            raise MergeError(f"AUTOINCREMENT counter for {name} was not preserved")


def _orphan_summary(reports: List[TableReport]) -> str:
    lines = ["Rows that belong to no existing user (they cannot satisfy FOREIGN KEY (user_id) REFERENCES users):"]
    for r in reports:
        reasons: Dict[str, int] = {}
        for row in r.excluded:
            reasons[row["_reason"]] = reasons.get(row["_reason"], 0) + 1
        detail = "; ".join(f"{n} x {why}" for why, n in sorted(reasons.items()))
        lines.append(f"  {r.name:22} {len(r.excluded):4} of {r.source_rows:<4} rows  ({detail})")
    lines.append("Nothing was written. Re-run with --allow-orphans to exclude them "
                 "(they are saved in full to a legacy-orphans-*.json file and the old files stay as they are).")
    return "\n".join(lines)


def _print_result(res: MergeResult, log: Callable[[str], None]) -> None:
    log(f"\n{'table':22} {'source':>7} {'migrated':>9} {'excluded':>9} {'new db':>7}  check")
    for r in res.tables:
        log(f"{r.name:22} {r.source_rows:>7} {r.migrated:>9} {len(r.excluded):>9} {r.in_new_db:>7}  {'ok' if r.ok else 'MISMATCH'}")
    total_src = sum(r.source_rows for r in res.tables)
    total_new = sum(r.in_new_db for r in res.tables)
    total_exc = sum(len(r.excluded) for r in res.tables)
    log(f"{'TOTAL':22} {total_src:>7} {total_new:>9} {total_exc:>9} {total_new:>7}")
    log(f"\nRow counts reconcile: {total_src} source rows = {total_new} migrated + {total_exc} excluded.")
    log("Integrity check, foreign-key check and per-table content checksums: ok.")
    log(f"Old files untouched (SHA-256 unchanged): {'yes' if res.originals_untouched else 'NO - investigate!'}")
    if res.orphan_report:
        log(f"Excluded rows saved to {res.orphan_report}")
    log(f"\nCreated {res.target}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Merge the old app.db + progression.db into data/coursemate.db",
                                     formatter_class=argparse.RawDescriptionHelpFormatter,
                                     epilog=__doc__.split("What it does", 1)[1] if __doc__ else "")
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("COURSEMATE_DATA_DIR", BACKEND / "data")),
                        help="folder holding app.db / progression.db (default: backend/data)")
    parser.add_argument("--allow-orphans", action="store_true",
                        help="exclude (and report) rows whose user_id matches no existing user")
    args = parser.parse_args(argv)
    try:
        result = merge(args.data_dir, allow_orphans=args.allow_orphans)
    except OrphansFound as exc:
        print(f"\n{exc}", file=sys.stderr)
        return 2
    except (MergeError, sqlite3.Error, OSError) as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1
    _print_result(result, print)
    return 0


if __name__ == "__main__":
    sys.exit(main())
