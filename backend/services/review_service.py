"""The spaced-repetition review queue (Phase 3, Stage 3A; docs/study-power.md).

ONE queue per user, across documents, scheduled with FSRS (the `fsrs` package, default parameters, 90% retention).
Cards come from:
    * a missed arena question ("study scroll"), a missed quiz question or a missed exam question - added by
      MasteryService.record() in the same transaction that stores the miss (`upsert_item`);
    * a flashcard, the first time it is graded in the Flashcards tab (or "Add deck to review").

Grades: 1 Again, 2 Hard, 3 Good, 4 Easy. Again counts as a miss for the concept's mastery, the others as a hit.
New cards per local day are limited (NEW_PER_DAY); a learning card due within LEARN_AHEAD is shown now, like
Anki, so a session can finish. A card already in the queue that is missed again elsewhere comes due again now.

A grade names the card's `reps` as the client saw it: a double submit (two tabs, a retried request) is refused
with 409 review_stale instead of being counted twice.
"""
from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Optional

from fsrs import Card, Rating, Scheduler, State

from core_brains.llm_schemas import question_key
from errors import AppError

NEW_PER_DAY = 20
LEARN_AHEAD = timedelta(minutes=20)
MAX_CARDS_PER_ADD = 100
MAX_FRONT, MAX_BACK, MAX_EXPLANATION, MAX_CONCEPT = 2000, 1000, 2000, 200
SOURCES = ("flashcard", "arena", "quiz", "exam")
STATE_NAMES = {1: "learning", 2: "review", 3: "relearning"}


def _utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def stamp(dt: datetime) -> str:
    """UTC, ISO seconds: one format everywhere, so string order is time order."""
    return _utc(dt).replace(microsecond=0).isoformat()


def parse(s: Optional[str]) -> Optional[datetime]:
    return _utc(datetime.fromisoformat(s)) if s else None


def item_key(front: str) -> str:
    return question_key(front)[:500]


def _clean(text, limit: int, squash: bool = False) -> str:
    """Trimmed text, at most `limit` characters; `squash` also folds every run of whitespace into one space."""
    text = str(text or "")
    return (" ".join(text.split()) if squash else text.strip())[:limit]


def upsert_item(store, user_id, doc_hash: str, *, front: str, back: str, source: str, explanation: Optional[str] = None,
                concept: Optional[str] = None, now: Optional[datetime] = None) -> Optional[int]:
    """Put a card in the queue, or - if it is already there - bring it due now (a fresh miss). Returns its id
    (None for an unusable card). Safe inside a store.transaction()."""
    front, back = _clean(front, MAX_FRONT), _clean(back, MAX_BACK)
    key = item_key(front)
    if not front or not back or not key or not doc_hash or source not in SOURCES:
        return None
    concept = _clean(concept, MAX_CONCEPT, squash=True) or None
    from services.mastery_service import concept_key            # (mastery imports this module)
    t = stamp(now or datetime.now(timezone.utc))
    store.execute(
        "INSERT INTO review_items (user_id, doc_hash, item_key, source, concept, concept_key, front, back, explanation, "
        "due, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(user_id, doc_hash, item_key) DO UPDATE SET back = excluded.back, "
        "explanation = COALESCE(excluded.explanation, explanation), concept = COALESCE(excluded.concept, concept), "
        "concept_key = COALESCE(excluded.concept_key, concept_key), "
        "due = MIN(due, excluded.due), updated_at = excluded.updated_at",
        (int(user_id), doc_hash, key, source, concept, concept_key(concept) if concept else None, front, back,
         (_clean(explanation, MAX_EXPLANATION) or None), t, t, t))
    row = store.fetchone("SELECT id FROM review_items WHERE user_id = ? AND doc_hash = ? AND item_key = ?",
                         (int(user_id), doc_hash, key))
    return int(row["id"]) if row else None


class ReviewService:
    def __init__(self, store, mastery=None, scheduler: Optional[Scheduler] = None):
        self.store = store
        self.mastery = mastery
        self.scheduler = scheduler or Scheduler()                       # fuzzed intervals in production
        self._preview = Scheduler(enable_fuzzing=False)                 # the interval shown on each grade button

    # ── cards ↔ rows ─────────────────────────────────────────────────────────
    @staticmethod
    def _card(row: dict) -> Card:
        return Card(card_id=int(row["id"]), state=State(int(row["state"])), step=row["step"],
                    stability=row["stability"], difficulty=row["difficulty"], due=parse(row["due"]),
                    last_review=parse(row["last_review"]))

    def _intervals(self, row: dict, now: datetime) -> dict:
        card = self._card(row)
        return {str(int(r)): max(0, int((self._preview.review_card(card, r, now)[0].due - now).total_seconds()))
                for r in Rating}

    def _public(self, row: dict, now: datetime, with_intervals: bool = True) -> dict:
        out = {
            "id": int(row["id"]), "front": row["front"], "back": row["back"], "explanation": row["explanation"],
            "concept": row["concept"], "source": row["source"],
            "state": "new" if not row["reps"] else STATE_NAMES[int(row["state"])],
            "due": row["due"], "reps": int(row["reps"]), "lapses": int(row["lapses"]),
            "document": {"session_id": row.get("doc_session_id"), "name": row.get("doc_name")},
        }
        if with_intervals:
            out["intervals"] = self._intervals(row, now)
        return out

    # the card's document (the user's latest with that content) - or its course, for a card made on a course
    _SELECT = ("SELECT r.*, COALESCE(d.id, c.id) AS doc_session_id, COALESCE(d.filename, c.name) AS doc_name "
               "FROM review_items r "
               "LEFT JOIN documents d ON d.id = (SELECT id FROM documents WHERE user_id = r.user_id "
               "AND file_hash = r.doc_hash ORDER BY last_used_at DESC LIMIT 1) "
               "LEFT JOIN courses c ON r.doc_hash = 'course:' || c.id AND c.user_id = r.user_id ")

    def _today(self, user_id) -> str:
        return self.store.user_today(str(user_id)).isoformat()

    def _counts_today(self, user_id) -> dict:
        row = self.store.fetchone(
            "SELECT COUNT(*) AS n, COALESCE(SUM(was_new), 0) AS new FROM review_logs WHERE user_id = ? AND local_date = ?",
            (int(user_id), self._today(user_id)))
        return {"reviewed": int(row["n"]), "new": int(row["new"])}

    def _get(self, user_id, item_id) -> dict:
        row = self.store.fetchone(self._SELECT + "WHERE r.id = ? AND r.user_id = ?", (int(item_id), int(user_id)))
        if not row:
            raise AppError("review_item_not_found", "That card isn't in your review queue.", status_code=404)
        return row

    # ── reading ──────────────────────────────────────────────────────────────
    def queue(self, user_id, *, limit: int = 20, doc_hash=None,
              now: Optional[datetime] = None) -> List[dict]:
        """What to review now: learning/relearning cards (incl. those due within LEARN_AHEAD), then due review
        cards (most overdue first), then new cards up to today's allowance (oldest first). `doc_hash` narrows it to
        one document, or to several (a course: its own cards and its documents')."""
        now = _utc(now or datetime.now(timezone.utc))
        limit = max(1, min(int(limit), 100))
        hashes = [doc_hash] if isinstance(doc_hash, str) else list(doc_hash or [])
        scope, params = (f"AND r.doc_hash IN ({','.join('?' for _ in hashes)}) ", hashes) if hashes else ("", [])
        learning = self.store.fetchall(
            self._SELECT + "WHERE r.user_id = ? AND r.reps > 0 AND r.state IN (1, 3) AND r.due <= ? " + scope +
            "ORDER BY r.due LIMIT ?", (int(user_id), stamp(now + LEARN_AHEAD), *params, limit))
        review = self.store.fetchall(
            self._SELECT + "WHERE r.user_id = ? AND r.reps > 0 AND r.state = 2 AND r.due <= ? " + scope +
            "ORDER BY r.due LIMIT ?", (int(user_id), stamp(now), *params, limit))
        new_left = max(0, NEW_PER_DAY - self._counts_today(user_id)["new"])
        new = self.store.fetchall(
            self._SELECT + "WHERE r.user_id = ? AND r.reps = 0 AND r.due <= ? " + scope +
            "ORDER BY r.due, r.id LIMIT ?", (int(user_id), stamp(now), *params, min(limit, new_left))) if new_left else []
        return [self._public(r, now) for r in (learning + review + new)[:limit]]

    def stats(self, user_id, *, now: Optional[datetime] = None) -> dict:
        now = _utc(now or datetime.now(timezone.utc))
        uid, t = int(user_id), stamp(now)
        q = lambda sql, *p: int(self.store.fetchone(sql, (uid, *p))["n"])           # noqa: E731
        today = self._counts_today(user_id)
        new_left = max(0, NEW_PER_DAY - today["new"])
        new_ready = q("SELECT COUNT(*) AS n FROM review_items WHERE user_id = ? AND reps = 0 AND due <= ?", t)
        learning = q("SELECT COUNT(*) AS n FROM review_items WHERE user_id = ? AND reps > 0 AND state IN (1, 3) AND due <= ?",
                     stamp(now + LEARN_AHEAD))
        review = q("SELECT COUNT(*) AS n FROM review_items WHERE user_id = ? AND reps > 0 AND state = 2 AND due <= ?", t)
        nxt = self.store.fetchone("SELECT MIN(due) AS d FROM review_items WHERE user_id = ? AND due > ?", (uid, t))
        by_source = {s: 0 for s in SOURCES}
        for r in self.store.fetchall("SELECT source, COUNT(*) AS n FROM review_items WHERE user_id = ? GROUP BY source", (uid,)):
            by_source[r["source"]] = int(r["n"])
        return {
            "due": learning + review + min(new_ready, new_left),
            "learning": learning, "review": review, "new": min(new_ready, new_left), "new_waiting": new_ready,
            "new_left_today": new_left, "reviewed_today": today["reviewed"],
            "total": sum(by_source.values()), "by_source": by_source, "next_due_at": nxt["d"] if nxt else None,
        }

    # ── writing ──────────────────────────────────────────────────────────────
    def add_cards(self, user_id, doc_hash: str, cards: Iterable[dict], *, source: str = "flashcard",
                  now: Optional[datetime] = None) -> dict:
        cards = list(cards)[:MAX_CARDS_PER_ADD]
        added = existing = skipped = 0
        with self.store.transaction():
            for c in cards:
                key = item_key(_clean(c.get("front"), MAX_FRONT))
                had = key and self.store.fetchone(
                    "SELECT 1 FROM review_items WHERE user_id = ? AND doc_hash = ? AND item_key = ?",
                    (int(user_id), doc_hash, key))
                got = upsert_item(self.store, user_id, doc_hash, front=c.get("front"), back=c.get("back"),
                                  explanation=c.get("explanation"), concept=c.get("concept") or c.get("topic"),
                                  source=source, now=now) if not had else None
                if had:
                    existing += 1
                elif got:
                    added += 1
                else:
                    skipped += 1
        return {"added": added, "existing": existing, "skipped": skipped}

    def grade(self, user_id, item_id, rating: int, *, reps: Optional[int] = None, duration_ms: Optional[int] = None,
              now: Optional[datetime] = None, count_mastery: bool = True) -> dict:
        """Apply one grade. `reps` (what the client saw) guards against counting a grade twice."""
        if int(rating) not in (1, 2, 3, 4):
            raise AppError("invalid_input", "Grade must be 1 (Again), 2 (Hard), 3 (Good) or 4 (Easy).", status_code=400)
        now = _utc(now or datetime.now(timezone.utc))
        with self.store.transaction():
            row = self._get(user_id, item_id)
            if reps is not None and int(reps) != int(row["reps"]):
                raise AppError("review_stale", "This card was already graded.", status_code=409,
                               details={"item": self._public(row, now)})
            was_new = int(row["reps"]) == 0
            card, _log = self.scheduler.review_card(self._card(row), Rating(int(rating)), now)
            lapse = int(rating) == 1 and int(row["state"]) == 2
            changed = self.store.execute(
                "UPDATE review_items SET state = ?, step = ?, stability = ?, difficulty = ?, due = ?, last_review = ?, "
                "reps = reps + 1, lapses = lapses + ?, updated_at = ? WHERE id = ? AND reps = ?",
                (int(card.state), card.step, card.stability, card.difficulty, stamp(card.due), stamp(now),
                 int(lapse), stamp(now), int(row["id"]), int(row["reps"])))
            if changed != 1:                                                        # raced by another grade
                raise AppError("review_stale", "This card was already graded.", status_code=409)
            self.store.execute(
                "INSERT INTO review_logs (user_id, item_id, rating, was_new, reviewed_at, local_date, duration_ms) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (int(user_id), int(row["id"]), int(rating), int(was_new), stamp(now), self._today(user_id),
                 max(0, min(int(duration_ms), 3_600_000)) if duration_ms is not None else None))
            mastery = None
            if count_mastery and self.mastery and row["concept"]:
                mastery = self.mastery.record(user_id, row["doc_hash"], row["concept"], int(rating) > 1, source="review")
            fresh = self._get(user_id, item_id)
        return {"item": self._public(fresh, now, with_intervals=False), "mastery": mastery, "was_new": was_new}

    def grade_first(self, user_id, doc_hash: str, card: dict, correct: bool, *, now: Optional[datetime] = None) -> Optional[dict]:
        """A flashcard graded in the Flashcards tab: it joins the queue, and - the first time only - that grade is its
        first review (Good / Again). Practising a card already in the queue leaves its schedule alone."""
        with self.store.transaction():
            item_id = upsert_item(self.store, user_id, doc_hash, front=card.get("front"), back=card.get("back"),
                                  explanation=card.get("explanation"), concept=card.get("concept"),
                                  source="flashcard", now=now)
            if item_id is None:
                return None
            row = self._get(user_id, item_id)
            if int(row["reps"]) == 0:                                    # (the flashcard route counts mastery itself)
                return self.grade(user_id, item_id, 3 if correct else 1, reps=0, now=now, count_mastery=False)["item"]
            return self._public(row, _utc(now or datetime.now(timezone.utc)), with_intervals=False)

    def remove(self, user_id, item_id) -> None:
        self._get(user_id, item_id)
        self.store.execute("DELETE FROM review_items WHERE id = ? AND user_id = ?", (int(item_id), int(user_id)))
