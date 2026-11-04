"""PostgreSQL behind the same interface as SQLite (Phase 3 Stage 4e; docs/postgres.md).

The app is written against Python's sqlite3 API and SQLite's SQL. With DATABASE_URL=postgresql://... the one
connection factory (database/connection.py) hands out this adapter instead, so no service changes:

    * `?` placeholders become `%s` (and a literal `%` becomes `%%` when there are parameters)
    * `INSERT OR IGNORE INTO ...` becomes `INSERT INTO ... ON CONFLICT DO NOTHING`
    * `BEGIN IMMEDIATE` becomes `BEGIN`; PRAGMAs are no-ops (the two checks answer "ok" / nothing wrong)
    * rows read like sqlite3.Row - by name AND by position; NUMERIC sums come back as int (or float)
    * True / False parameters become 1 / 0 (the columns are integers, as in SQLite)
    * errors are re-raised as sqlite3.IntegrityError / sqlite3.OperationalError, so `except sqlite3...` works
    * inside a transaction every statement runs under a SAVEPOINT, so a failed statement (a duplicate insert the
      code expects and catches) rolls back alone, as in SQLite, instead of aborting the whole transaction

Outside a transaction the connection autocommits, which is what the code's explicit commit() calls assume.
The schema itself comes from migrations/postgres/ (database/migrate.py).
"""
import re
import sqlite3
import datetime as _dt
from decimal import Decimal
from typing import Any, Iterable, Optional

URL_PREFIXES = ("postgres://", "postgresql://")


def is_url(target) -> bool:
    return str(target).startswith(URL_PREFIXES)


# ── SQL translation ──────────────────────────────────────────────────────────
_BEGIN = re.compile(r"^\s*BEGIN(\s+(IMMEDIATE|DEFERRED|EXCLUSIVE))?(\s+TRANSACTION)?\s*;?\s*$", re.I)
_END = re.compile(r"^\s*(COMMIT|END|ROLLBACK)(\s+TRANSACTION)?\s*;?\s*$", re.I)
_PRAGMA = re.compile(r"^\s*PRAGMA\s+([a-z_]+)", re.I)
_INSERT_IGNORE = re.compile(r"\bINSERT\s+OR\s+IGNORE\s+INTO\b", re.I)
_RETURNING = re.compile(r"\bRETURNING\b", re.I)
_SAVEPOINT = re.compile(r"^\s*(SAVEPOINT|RELEASE|ROLLBACK\s+TO)\b", re.I)


def _placeholders(sql: str, escape_percent: bool) -> str:
    """? -> %s outside quoted strings / identifiers; % -> %% when the driver will format the query."""
    out, quote = [], None
    for ch in sql:
        if quote:
            if ch == quote:
                quote = None
            out.append("%%" if (ch == "%" and escape_percent) else ch)
        elif ch in ("'", '"'):
            quote = ch
            out.append(ch)
        elif ch == "?":
            out.append("%s")
        elif ch == "%" and escape_percent:
            out.append("%%")
        else:
            out.append(ch)
    return "".join(out)


_UPSERT = re.compile(r"^\s*INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)(.*?\bDO\s+UPDATE\s+SET\b)(.*)$", re.I | re.S)
_TAIL = re.compile(r"\bRETURNING\b", re.I)


def _qualify(expr: str, table: str, columns: set) -> str:
    """In an upsert's DO UPDATE part, a bare column means the existing row: SQLite allows it, PostgreSQL calls it
    ambiguous, so it is written table.column (excluded.x and anything already qualified are left alone)."""
    out, i, n = [], 0, len(expr)
    while i < n:
        ch = expr[i]
        if ch == "'":
            j = expr.index("'", i + 1) if "'" in expr[i + 1:] else n - 1
            out.append(expr[i:j + 1])
            i = j + 1
            continue
        m = re.match(r"[A-Za-z_][A-Za-z0-9_]*", expr[i:])
        if m:
            word = m.group(0)
            prev = expr[:i].rstrip()[-1:] if expr[:i].rstrip() else ""
            after = expr[i + len(word):].lstrip()[:1]
            assign = after == "=" and not expr[i + len(word):].lstrip().startswith("==")
            if word.lower() in columns and prev != "." and after != "(" and after != "." and not assign:
                out.append(f"{table}.{word}")
            else:
                out.append(word)
            i += len(word)
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _fix_upsert(s: str) -> str:
    m = _UPSERT.match(s)
    if not m:
        return s
    table, cols, middle, rest = m.group(1), m.group(2), m.group(3), m.group(4)
    columns = {c.strip().lower() for c in cols.split(",") if c.strip()}
    t = _TAIL.search(rest)
    body, tail = (rest[:t.start()], rest[t.start():]) if t else (rest, "")
    return f"INSERT INTO {table} ({cols}){middle}{_qualify(body, table, columns)}{tail}"


_MINMAX = re.compile(r"\b(MIN|MAX)\s*\(", re.I)


def _scalar_minmax(s: str) -> str:
    """SQLite's MIN(a, b) / MAX(a, b) with two or more arguments are PostgreSQL's LEAST / GREATEST."""
    out, pos = [], 0
    for m in _MINMAX.finditer(s):
        if m.start() < pos:
            continue
        depth, i, comma = 1, m.end(), False
        while i < len(s) and depth:
            c = s[i]
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            elif c == "," and depth == 1:
                comma = True
            elif c == "'":
                i = s.find("'", i + 1)
                if i < 0:
                    break
            i += 1
        if comma:
            out.append(s[pos:m.start()])
            out.append("LEAST(" if m.group(1).upper() == "MIN" else "GREATEST(")
            pos = m.end()
    out.append(s[pos:])
    return "".join(out)


def translate(sql: str, has_params: bool = True) -> str:
    s = _scalar_minmax(_fix_upsert(sql.strip().rstrip(";")))
    if _INSERT_IGNORE.search(s):
        s = _INSERT_IGNORE.sub("INSERT INTO", s)
        m = _RETURNING.search(s)
        s = (s[:m.start()] + "ON CONFLICT DO NOTHING " + s[m.start():]) if m else s + " ON CONFLICT DO NOTHING"
    return _placeholders(s, escape_percent=has_params)


def _param(v: Any) -> Any:
    return int(v) if isinstance(v, bool) else v


def _value(v: Any) -> Any:
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, memoryview):
        return v.tobytes()
    if isinstance(v, _dt.datetime):                 # SQLite hands back the stored text; so do we
        return v.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(v, _dt.date):
        return v.isoformat()
    return v


class Row(dict):
    """A dict that can also be indexed by position, like sqlite3.Row."""
    __slots__ = ("_values",)

    def __init__(self, names, values):
        super().__init__(zip(names, values))
        self._values = list(values)

    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)

    def __iter__(self):                         # dict(row) still works through keys(); iteration gives values
        return iter(self._values)

    def __len__(self):
        return len(self._values)


def _row_factory(cursor):
    names = [d.name for d in (cursor.description or [])]

    def make(values):
        return Row(names, [_value(v) for v in values])
    return make


class _Result:
    """What execute() returns: the sqlite3.Cursor surface the app uses."""

    def __init__(self, rows=None, rowcount: int = -1, description=None):
        self._rows = list(rows or [])
        self.rowcount = rowcount
        self.lastrowid = None                  # use INSERT ... RETURNING id (works on both databases)
        self.description = description

    def fetchone(self):
        return self._rows.pop(0) if self._rows else None

    def fetchall(self):
        rows, self._rows = self._rows, []
        return rows

    def __iter__(self):
        return iter(self.fetchall())


class Connection:
    def __init__(self, url: str):
        import psycopg
        self._psycopg = psycopg
        self._c = psycopg.connect(url, autocommit=True, row_factory=_row_factory)
        self.in_transaction = False
        self.row_factory = None                 # accepted and ignored (rows are always Row)

    # ── statements ───────────────────────────────────────────────────────────
    def execute(self, sql: str, params: Optional[Iterable] = None) -> _Result:
        if _BEGIN.match(sql):
            if not self.in_transaction:
                self._c.execute("BEGIN")
                self.in_transaction = True
            return _Result()
        m = _END.match(sql)
        if m:
            (self.commit if m.group(1).upper() in ("COMMIT", "END") else self.rollback)()
            return _Result()
        p = _PRAGMA.match(sql)
        if p:
            name = p.group(1).lower()
            return _Result([Row(["integrity_check"], ["ok"])] if name in ("integrity_check", "quick_check") else [])
        args = [_param(v) for v in params] if params else None
        query = translate(sql, has_params=bool(args))
        psycopg = self._psycopg
        if _SAVEPOINT.match(sql):                       # the code's own savepoints: as they are, never wrapped
            try:
                self._c.execute(query, args)
            except psycopg.Error as exc:
                raise sqlite3.OperationalError(str(exc).strip()) from exc
            return _Result()
        if self.in_transaction:
            self._c.execute("SAVEPOINT cm_stmt")
        try:
            cur = self._c.execute(query, args)
            rows = cur.fetchall() if cur.description else []
            result = _Result(rows, cur.rowcount, cur.description)
        except psycopg.Error as exc:
            if self.in_transaction:
                self._c.execute("ROLLBACK TO SAVEPOINT cm_stmt")
            kind = sqlite3.IntegrityError if isinstance(exc, psycopg.errors.IntegrityError) else sqlite3.OperationalError
            raise kind(str(exc).strip()) from exc
        if self.in_transaction:
            self._c.execute("RELEASE SAVEPOINT cm_stmt")
        return result

    def executemany(self, sql: str, seq: Iterable[Iterable]) -> _Result:
        total = 0
        for params in seq:
            total += max(0, self.execute(sql, params).rowcount)
        return _Result(rowcount=total)

    def executescript(self, script: str) -> None:
        """Several statements at once (migrations): sent as they are, no placeholders."""
        try:
            self._c.execute(script)
        except self._psycopg.Error as exc:
            raise sqlite3.OperationalError(str(exc).strip()) from exc

    def cursor(self) -> "Connection":
        return _CursorShim(self)

    # ── transactions ─────────────────────────────────────────────────────────
    def commit(self) -> None:
        if self.in_transaction:
            self.in_transaction = False
            self._c.execute("COMMIT")

    def rollback(self) -> None:
        if self.in_transaction:
            self.in_transaction = False
            self._c.execute("ROLLBACK")

    def close(self) -> None:
        self._c.close()

    def __enter__(self):
        self.execute("BEGIN")
        return self

    def __exit__(self, exc_type, exc, tb):
        (self.rollback if exc_type else self.commit)()
        return False


class _CursorShim:
    """conn.cursor().execute(...) then .fetchone() / .lastrowid, like sqlite3."""

    def __init__(self, conn: Connection):
        self._conn, self._result = conn, _Result()

    def execute(self, sql, params=None):
        self._result = self._conn.execute(sql, params)
        return self

    def fetchone(self):
        return self._result.fetchone()

    def fetchall(self):
        return self._result.fetchall()

    @property
    def rowcount(self):
        return self._result.rowcount

    @property
    def lastrowid(self):
        return None

    def __iter__(self):
        return iter(self._result.fetchall())
