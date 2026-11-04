"""The per-document quiz bank (Phase 3 Stage 4b; docs/model-routing.md).

Every quiz question generated for a document is kept, keyed by the document's CONTENT (file hash), the topic and
the question type - so it is shared by every user who has the same PDF. A quiz request is served from the bank,
with no AI call, when the bank holds enough questions this user hasn't been given yet; otherwise a fresh batch is
generated and added to it. A user never gets the same banked question twice (quiz_bank_served), so asking again
still brings new questions. QUIZ_BANK=0 turns it off.
"""
import json
import os
import random
from datetime import datetime, timezone
from typing import Dict, List, Optional

from core_brains.llm_schemas import question_key

MAX_PER_TOPIC = 400                  # a runaway topic can't grow the table without end


def enabled() -> bool:
    return (os.environ.get("QUIZ_BANK") or "1").strip().lower() not in ("0", "false", "no", "off")


def topic_key(topic: str) -> str:
    return question_key(topic or "")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class QuizBank:
    def __init__(self, store, rng: Optional[random.Random] = None):
        self.store = store
        self.rng = rng or random.Random()

    def take(self, user_id, doc_hash: str, topic: str, question_type: str, n: int) -> Optional[List[Dict]]:
        """n questions this user hasn't had, marked as had - or None (and nothing marked) when there aren't n."""
        rows = self.store.fetchall(
            "SELECT b.id, b.question_json FROM quiz_bank b WHERE b.doc_hash = ? AND b.topic_key = ? AND b.question_type = ? "
            "AND NOT EXISTS (SELECT 1 FROM quiz_bank_served s WHERE s.user_id = ? AND s.bank_id = b.id) ORDER BY b.id",
            (doc_hash, topic_key(topic), question_type, int(user_id)))
        if len(rows) < n:
            return None
        picked = sorted(self.rng.sample(rows, n), key=lambda r: r["id"])
        self.mark_served(user_id, [r["id"] for r in picked])
        out = []
        for i, r in enumerate(picked, start=1):
            q = json.loads(r["question_json"])
            q["id"] = i
            out.append(q)
        return out

    def add(self, doc_hash: str, topic: str, question_type: str, questions: List[Dict], model: str = "") -> List[int]:
        """Keep a generated batch (each question text once). Returns the bank ids of the batch's questions."""
        tk, ids = topic_key(topic), []
        count = self.store.fetchone("SELECT COUNT(*) AS n FROM quiz_bank WHERE doc_hash = ? AND topic_key = ? AND question_type = ?",
                                    (doc_hash, tk, question_type))["n"]
        for q in questions:
            text = question_key(str(q.get("question") or ""))
            if not text:
                continue
            if count < MAX_PER_TOPIC:
                body = {k: v for k, v in q.items() if k != "id"}
                count += self.store.execute(
                    "INSERT OR IGNORE INTO quiz_bank (doc_hash, topic_key, question_type, text_key, question_json, model, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)", (doc_hash, tk, question_type, text, json.dumps(body), model or None, _now()))
            row = self.store.fetchone("SELECT id FROM quiz_bank WHERE doc_hash = ? AND topic_key = ? AND question_type = ? AND text_key = ?",
                                      (doc_hash, tk, question_type, text))
            if row:
                ids.append(row["id"])
        return ids

    def mark_served(self, user_id, bank_ids: List[int]) -> None:
        now = _now()
        for bid in bank_ids:
            self.store.execute("INSERT OR IGNORE INTO quiz_bank_served (user_id, bank_id, served_at) VALUES (?, ?, ?)",
                               (int(user_id), int(bid), now))

    def size(self, doc_hash: str, topic: str, question_type: str) -> int:
        return self.store.fetchone("SELECT COUNT(*) AS n FROM quiz_bank WHERE doc_hash = ? AND topic_key = ? AND question_type = ?",
                                   (doc_hash, topic_key(topic), question_type))["n"]
