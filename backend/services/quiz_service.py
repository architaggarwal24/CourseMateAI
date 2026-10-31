"""Server-side quizzes: the browser never sees a correct answer before it has answered that question.

    create()  stores the generated questions WITH their correct answers under a new quiz_id and returns the
              questions without correct_answer / explanation
    answer()  grades ONE question on the server and returns correct / incorrect + the correct answer and
              explanation (the instant feedback). The first answer to a question is final: asking again returns
              the same result, so a question can't be used to probe for the answer.
    finish()  computes the accuracy from the stored answers and awards quiz_complete - once per quiz_id.
              Replaying it awards nothing.

The first answer to each question is also counted for its concept (services/mastery_service.py: the question's
`concept`, or the quiz topic when the generator gave none), in the same transaction; a replay counts nothing.
"""
import json
import unicodedata
import uuid
from typing import List, Optional

from errors import AppError
from services.progression.time_utils import utc_now_iso

# What a question loses before it is sent to the browser.
SECRET_FIELDS = ("correct_answer", "explanation")
# The accuracy-independent multipliers the browser used to send (kept so honest play earns what it always did).
QUIZ_DIFFICULTY = 1.2


def _norm(text) -> str:
    """Comparison form of an answer: case-folded letters and digits only (any script)."""
    return "".join(ch for ch in unicodedata.normalize("NFKC", str(text)).casefold() if ch.isalnum())


def same_answer(a, b) -> bool:
    na, nb = _norm(a), _norm(b)
    if na or nb:
        return na == nb
    return str(a).strip().casefold() == str(b).strip().casefold()          # symbols-only answers


def _quiz_not_found() -> AppError:
    return AppError("quiz_not_found", "We couldn't find that quiz. Please generate a new one.", status_code=404)


class QuizService:
    def __init__(self, store, reward_service, mastery=None):
        self.store = store
        self.rewards = reward_service
        self.mastery = mastery

    # ── create ───────────────────────────────────────────────────────────────
    def create(self, user_id: str, session_id: str, topic: str, question_type: str, quiz_data: dict) -> dict:
        """Store a generated quiz; returns {"quiz_id", "content": {"questions": [...no answers...]}}."""
        questions = [dict(q) for q in quiz_data.get("questions", [])]
        for i, q in enumerate(questions, start=1):
            q["id"] = i if not isinstance(q.get("id"), int) else q["id"]
        if len({q["id"] for q in questions}) != len(questions):
            for i, q in enumerate(questions, start=1):
                q["id"] = i
        quiz_id = uuid.uuid4().hex
        self.store.execute(
            "INSERT INTO quizzes (id, user_id, session_id, topic, question_type, questions_json, question_count, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (quiz_id, user_id, session_id, topic, question_type, json.dumps(questions), len(questions), utc_now_iso()))
        return {"quiz_id": quiz_id,
                "content": {**{k: v for k, v in quiz_data.items() if k != "questions"},
                            "questions": [self.public(q) for q in questions]}}

    @staticmethod
    def public(question: dict) -> dict:
        """A question as the browser may see it."""
        return {k: v for k, v in question.items() if k not in SECRET_FIELDS}

    # ── helpers ──────────────────────────────────────────────────────────────
    def _quiz(self, user_id: str, quiz_id: str) -> dict:
        row = self.store.fetchone("SELECT * FROM quizzes WHERE id = ? AND user_id = ?", (str(quiz_id), user_id))
        if not row:
            raise _quiz_not_found()                  # someone else's quiz looks exactly like a missing one
        row["questions"] = json.loads(row["questions_json"])
        return row

    @staticmethod
    def _correct_option(question: dict) -> str:
        """The correct answer written exactly like one of the options (so the browser can highlight it)."""
        correct = str(question.get("correct_answer", ""))
        return next((o for o in question.get("options", []) if same_answer(o, correct)), correct)

    def _feedback(self, question: dict, answer: str, correct: bool) -> dict:
        return {"ok": True, "question_id": question["id"], "answer": answer, "correct": bool(correct),
                "correct_answer": self._correct_option(question), "explanation": question.get("explanation") or None}

    # ── answer ───────────────────────────────────────────────────────────────
    def answer(self, user_id: str, quiz_id: str, question_id: int, answer: str) -> dict:
        quiz = self._quiz(user_id, quiz_id)
        question = next((q for q in quiz["questions"] if q["id"] == question_id), None)
        if question is None:
            raise AppError("question_not_found", "That question isn't part of this quiz.", status_code=404)
        picked = next((o for o in question.get("options", []) if same_answer(o, answer)), None)
        if picked is None:
            raise AppError("invalid_answer", "Pick one of the answer options.", status_code=400)

        # First answer wins: the insert is a no-op when the question was already answered.
        correct = same_answer(picked, question.get("correct_answer", ""))
        with self.store.transaction():
            first = self.store.execute(
                "INSERT INTO quiz_answers (quiz_id, question_id, answer, correct, answered_at) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(quiz_id, question_id) DO NOTHING",
                (quiz["id"], question["id"], picked, int(correct), utc_now_iso())) == 1
            if first and self.mastery is not None:
                doc_hash = self.mastery.doc_hash_for(quiz["session_id"], user_id)
                if doc_hash:
                    self.mastery.record(user_id, doc_hash, question.get("concept") or quiz["topic"], correct,
                                        source="quiz", question={"question": question.get("question"),
                                                                 "correct_answer": self._correct_option(question),
                                                                 "explanation": question.get("explanation")})
            stored = self.store.fetchone(
                "SELECT answer, correct FROM quiz_answers WHERE quiz_id = ? AND question_id = ?",
                (quiz["id"], question["id"]))
        return self._feedback(question, stored["answer"], stored["correct"])

    # ── finish ───────────────────────────────────────────────────────────────
    def finish(self, user_id: str, quiz_id: str) -> dict:
        with self.store.transaction():
            quiz = self._quiz(user_id, quiz_id)
            total = int(quiz["question_count"])
            if quiz["finished_at"] is not None:
                return self._result(quiz, already_finished=True)

            row = self.store.fetchone(
                "SELECT COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct FROM quiz_answers WHERE quiz_id = ?",
                (quiz["id"],))
            answered, correct = int(row["answered"]), int(row["correct"])
            if answered < total:
                raise AppError("quiz_incomplete", "Answer every question before finishing the quiz.", status_code=400,
                               details={"answered": answered, "total": total})
            accuracy = correct / max(total, 1)

            # Compare-and-set: exactly one finish wins, and the reward is written in the SAME transaction.
            won = self.store.execute(
                "UPDATE quizzes SET finished_at = ?, correct_count = ?, accuracy = ? WHERE id = ? AND finished_at IS NULL",
                (utc_now_iso(), correct, accuracy, quiz["id"]))
            if won != 1:
                return self._result(self._quiz(user_id, quiz_id), already_finished=True)
            rewards = self.rewards.award(user_id, "quiz_complete", accuracy=accuracy, difficulty=QUIZ_DIFFICULTY,
                                         combo_count=1, source_id=quiz["id"])
            return {"ok": True, "quiz_id": quiz["id"], "score": correct, "total": total, "accuracy": accuracy,
                    "already_finished": False, "rewards": rewards}

    @staticmethod
    def _result(quiz: dict, already_finished: bool) -> dict:
        """The stored outcome of a finished quiz. Nothing is awarded here."""
        return {"ok": True, "quiz_id": quiz["id"], "score": int(quiz["correct_count"] or 0),
                "total": int(quiz["question_count"]), "accuracy": float(quiz["accuracy"] or 0.0),
                "already_finished": already_finished, "rewards": None}
