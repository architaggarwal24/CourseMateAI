"""Concept mastery: which concepts of a document a user keeps getting wrong (docs/arena-v2.md section 3).

    record()         one answer about a concept: seen +1, correct +1 or wrong streak +1. A wrong answer also keeps
                     the question (text, correct answer, explanation) in missed_questions for the review deck.
                     Written by arena answers (inside the battle's transaction), server-graded quiz answers and
                     flashcard reviews - each caller records an answer ONCE (a replayed answer records nothing).
    weak_concepts()  the concepts with misses, weakest first (misses + current wrong streak + how recent the last
                     miss was). What a Nemesis boss is built from.
    review_deck()    flashcards made from the stored missed questions - no LLM call.

Everything is keyed by the document's content HASH, not the session id: uploading the same PDF again keeps the
history, and the conftest-style "documents table is wiped" never loses mastery.
"""
import math
from datetime import datetime, timezone
from typing import List, Optional

from core_brains.llm_schemas import question_key
from services.progression.time_utils import utc_now_iso

NEMESIS_MIN_CONCEPTS = 3            # a Nemesis needs at least this many missed concepts
RECENCY_HALF_LIFE_DAYS = 7.0        # a miss counts half as "recent" after a week
MAX_CONCEPT_CHARS = 200


def concept_key(concept) -> str:
    return question_key(str(concept or ""))[:MAX_CONCEPT_CHARS]


class MasteryService:
    def __init__(self, store):
        self.store = store

    def doc_hash_for(self, session_id: str, user_id) -> Optional[str]:
        """The content hash of the user's document (None if it isn't theirs / doesn't exist)."""
        row = self.store.fetchone("SELECT file_hash FROM documents WHERE id = ? AND user_id = ?",
                                  (str(session_id), int(user_id)))
        return row["file_hash"] if row else None

    # ── writing ──────────────────────────────────────────────────────────────
    def record(self, user_id, doc_hash: str, concept: str, correct: bool, *, question: Optional[dict] = None,
               source: str = "arena") -> Optional[dict]:
        """Count one answer about `concept`. `question` ({question, correct_answer, explanation}) is kept when the
        answer was wrong. Returns the concept's new counters (None when there is no usable concept)."""
        concept = " ".join(str(concept or "").split())[:MAX_CONCEPT_CHARS]
        key = concept_key(concept)
        if not key or not doc_hash:
            return None
        now = utc_now_iso()
        with self.store.transaction():
            self.store.execute(
                "INSERT INTO concept_mastery (user_id, doc_hash, concept_key, concept, seen, correct, wrong_streak, "
                "last_seen_at, last_wrong_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?) "
                "ON CONFLICT(user_id, doc_hash, concept_key) DO UPDATE SET concept = excluded.concept, "
                "seen = seen + 1, correct = correct + excluded.correct, "
                "wrong_streak = CASE WHEN excluded.correct = 1 THEN 0 ELSE wrong_streak + 1 END, "
                "last_seen_at = excluded.last_seen_at, "
                "last_wrong_at = COALESCE(excluded.last_wrong_at, last_wrong_at)",
                (int(user_id), doc_hash, key, concept, int(bool(correct)), int(not correct), now,
                 None if correct else now))
            if not correct and question and str(question.get("question") or "").strip():
                text = str(question["question"]).strip()
                self.store.execute(
                    "INSERT INTO missed_questions (user_id, doc_hash, text_key, concept_key, concept, source, question, "
                    "correct_answer, explanation, missed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(user_id, doc_hash, text_key) DO UPDATE SET missed_at = excluded.missed_at, "
                    "source = excluded.source",
                    (int(user_id), doc_hash, question_key(text)[:500] or key, key, concept, source, text[:2000],
                     str(question.get("correct_answer") or "")[:1000],
                     (str(question.get("explanation") or "")[:2000] or None), now))
            row = self.store.fetchone(
                "SELECT concept, seen, correct, wrong_streak FROM concept_mastery "
                "WHERE user_id = ? AND doc_hash = ? AND concept_key = ?", (int(user_id), doc_hash, key))
        return row

    # ── reading ──────────────────────────────────────────────────────────────
    @staticmethod
    def _score(row: dict, now: datetime) -> float:
        misses = row["seen"] - row["correct"]
        recency = 0.0
        if row["last_wrong_at"]:
            days = max(0.0, (now - datetime.fromisoformat(row["last_wrong_at"])).total_seconds() / 86400)
            recency = math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS)
        return round(misses + 1.5 * row["wrong_streak"] + 2.0 * recency, 3)

    def weak_concepts(self, user_id, doc_hash: str, limit: int = 8) -> List[dict]:
        """Concepts answered wrong at least once, weakest first."""
        rows = self.store.fetchall(
            "SELECT * FROM concept_mastery WHERE user_id = ? AND doc_hash = ? AND seen > correct",
            (int(user_id), doc_hash))
        now = datetime.now(timezone.utc)
        out = [{"concept": r["concept"], "seen": r["seen"], "correct": r["correct"], "misses": r["seen"] - r["correct"],
                "wrong_streak": r["wrong_streak"], "last_wrong_at": r["last_wrong_at"], "score": self._score(r, now)}
               for r in rows]
        out.sort(key=lambda c: (-c["score"], -c["misses"], c["concept"]))
        return out[:max(1, int(limit))]

    def missed_count(self, user_id, doc_hash: str) -> int:
        return int(self.store.fetchone(
            "SELECT COUNT(*) AS n FROM concept_mastery WHERE user_id = ? AND doc_hash = ? AND seen > correct",
            (int(user_id), doc_hash))["n"])

    def nemesis_ready(self, user_id, doc_hash: str) -> bool:
        return self.missed_count(user_id, doc_hash) >= NEMESIS_MIN_CONCEPTS

    def missed_questions(self, user_id, doc_hash: str, concept: Optional[str] = None, limit: int = 50) -> List[dict]:
        sql = "SELECT * FROM missed_questions WHERE user_id = ? AND doc_hash = ?"
        params = [int(user_id), doc_hash]
        if concept is not None:
            sql += " AND concept_key = ?"
            params.append(concept_key(concept))
        sql += " ORDER BY missed_at DESC LIMIT ?"
        params.append(int(limit))
        return self.store.fetchall(sql, tuple(params))

    def review_deck(self, user_id, doc_hash: str, limit: int = 50) -> List[dict]:
        """Flashcards (front = the missed question, back = its correct answer) - built from stored data only."""
        return [{"front": r["question"], "back": r["correct_answer"], "explanation": r["explanation"],
                 "concept": r["concept"], "topic": r["concept"], "difficulty": "medium", "source": r["source"],
                 "missed_at": r["missed_at"]}
                for r in self.missed_questions(user_id, doc_hash, limit=limit)]
