"""Copy a CourseMate SQLite database into an empty PostgreSQL one (Phase 3 Stage 4e; docs/postgres.md).

    python scripts/sqlite_to_postgres.py --sqlite data/coursemate.db --url postgresql://coursemate:pw@localhost:5432/coursemate

  * The SQLite file must be at the newest migration (start the app on it once after updating) - it is only read.
  * The PostgreSQL database must be empty: it is migrated here (the baseline and anything after it), then every
    table is copied in foreign-key order with COPY, identity counters are moved past the copied ids, and the row
    counts of both sides are compared. Nothing is changed on the SQLite side.
  * Then set DATABASE_URL to the same URL and start the app. Keep the SQLite file as your fallback.
"""
import argparse
import sqlite3
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from database.migrate import discover, discover_pg, migrate  # noqa: E402

SKIP = {"schema_migrations"}


def _fk_order(conn) -> list:
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
    deps = {t: {r[2] for r in conn.execute(f'PRAGMA foreign_key_list("{t}")')} - {t} for t in tables}
    out, seen = [], set()

    def visit(t):
        if t in seen:
            return
        seen.add(t)
        for d in sorted(deps.get(t, ())):
            if d in deps:
                visit(d)
        out.append(t)
    for t in sorted(tables):
        visit(t)
    return [t for t in out if t not in SKIP]


def copy(sqlite_path: str, url: str, out=print) -> dict:
    import psycopg
    src = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    have = {r[0] for r in src.execute("SELECT version FROM schema_migrations")}
    latest = discover()[-1].version
    if max(have, default=0) != latest:
        raise SystemExit(f"{sqlite_path} is at version {max(have, default=0)}, the code at {latest}: start the app on it once, then copy.")
    if discover_pg()[-1].version != latest:
        raise SystemExit("migrations/postgres/ is behind migrations/: run scripts/postgres_schema.py or add the missing twin.")

    with psycopg.connect(url, autocommit=True) as pg:
        existing = pg.execute("SELECT to_regclass('public.users')").fetchone()[0]
        if existing and pg.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
            raise SystemExit("The PostgreSQL database already has users: copy into an empty database only.")
    migrate(url)

    counts = {}
    with psycopg.connect(url) as pg:                       # one transaction: all or nothing
        pg_cols = {}
        for t, c in pg.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"):
            pg_cols.setdefault(t, set()).add(c)
        for table in _fk_order(src):
            cols = [r[1] for r in src.execute(f'PRAGMA table_info("{table}")') if r[1] in pg_cols.get(table, set())]
            if not cols:
                continue
            col_list = ", ".join(f'"{c}"' for c in cols)
            n = 0
            with pg.cursor().copy(f'COPY "{table}" ({col_list}) FROM STDIN') as cp:
                for row in src.execute(f'SELECT {col_list} FROM "{table}"'):
                    cp.write_row([int(v) if isinstance(v, bool) else v for v in row])
                    n += 1
            counts[table] = n
            out(f"  {table:<28} {n:>8} rows")
        for (table,) in pg.execute("SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' "
                                   "AND column_name = 'id' AND is_identity = 'YES'").fetchall():
            pg.execute(f"SELECT setval(pg_get_serial_sequence('\"{table}\"', 'id'), "
                       f"COALESCE((SELECT MAX(id) FROM \"{table}\"), 0) + 1, false)")
        for table, n in counts.items():
            got = pg.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            if got != n:
                raise SystemExit(f"{table}: copied {n} rows but PostgreSQL has {got}; nothing was committed.")
    src.close()
    out(f"Copied {sum(counts.values())} rows in {len(counts)} tables. Now set DATABASE_URL and start the app.")
    return counts


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Copy a CourseMate SQLite database into an empty PostgreSQL database")
    p.add_argument("--sqlite", default=str(BACKEND / "data" / "coursemate.db"))
    p.add_argument("--url", required=True, help="postgresql://user:password@host:5432/dbname")
    a = p.parse_args(argv)
    copy(a.sqlite, a.url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
