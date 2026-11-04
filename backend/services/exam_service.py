"""Exam mode (Phase 3, Stage 3A; docs/study-power.md): a timed mock test from a document.

    create()   stores the written questions with their answers (which never leave the server before grading) and
               starts the clock: time_limit = questions x SECONDS_PER_QUESTION[difficulty]. One exam in progress
               per user (409 exam_in_progress names it, so the browser can resume it).
    answer()   saves / changes / clears an answer and the "flag for review" mark - any number of times until the
               exam is graded. No feedback, no hints.
    submit()   grades it once (compare-and-set active -> graded): score, accuracy, time used, a per-concept and
               per-difficulty breakdown. Every question counts for its concept's mastery; every miss goes to the
               spaced-repetition review queue (source 'exam'); exam_complete is paid once per exam.
    get()      the exam as the browser may see it; past the deadline (+ GRACE) an active exam is graded on read,
               with the answers saved so far (auto_submitted).
"""
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from errors import AppError
from services.quiz_service import same_answer
from services.review_service import stamp

LENGTHS = (10, 20, 30)
DIFFICULTIES = ("easy", "medium", "hard", "mixed")
SECONDS_PER_QUESTION = {"easy": 60, "medium": 75, "hard": 90, "mixed": 75}
GRACE = timedelta(seconds=5)                  # answers in flight when the clock hits zero still count
MIN_SHARE = 0.6                               # fewer usable questions than this share of the asked length: no exam
MAX_TOPICS = 5


def _now(now: Optional[datetime]) -> datetime:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc)


def _exam_not_found() -> AppError:
    return AppError("exam_not_found", "That exam doesn't exist.", status_code=404)


def time_limit(length: int, difficulty: str) -> int:
    return int(length) * SECONDS_PER_QUESTION[difficulty]


class ExamService:
    def __init__(self, store, reward_service=None, mastery=None, quests=None):
        self.store = store
        self.rewards = reward_service
        self.mastery = mastery
        self.quests = quests

    # ── create ───────────────────────────────────────────────────────────────
    def active(self, user_id, now: Optional[datetime] = None) -> Optional[dict]:
        """The exam in progress (graded first if its time ran out), or None."""
        row = self.store.fetchone("SELECT id FROM exams WHERE user_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1",
                                  (int(user_id),))
        if not row:
            return None
        exam = self.get(user_id, row["id"], now=now)
        return exam if exam["status"] == "active" else None

    def create(self, user_id, *, session_id: str, doc_hash: str, doc_name: str, length: int, difficulty: str,
               topics: List[str], questions: List[dict], now: Optional[datetime] = None) -> dict:
        now = _now(now)
        if not questions or len(questions) < max(1, int(length * MIN_SHARE)):
            raise AppError("generation_failed", "Not enough exam questions could be written from this document. "
                           "Please try again (or pick broader topics).", status_code=503, action="retry",
                           details={"retryable": True, "written": len(questions)})
        questions = questions[:length]
        limit = time_limit(len(questions), difficulty)
        exam_id = uuid.uuid4().hex
        with self.store.transaction():
            running = self.store.fetchone("SELECT id FROM exams WHERE user_id = ? AND status = 'active'", (int(user_id),))
            if running and self.get(user_id, running["id"], now=now)["status"] == "active":
                raise AppError("exam_in_progress", "Finish (or submit) the exam you started first.", status_code=409,
                               details={"exam_id": running["id"]})
            self.store.execute(
                "INSERT INTO exams (id, user_id, session_id, doc_hash, doc_name, length, difficulty, topics_json, "
                "time_limit_s, started_at, deadline, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (exam_id, int(user_id), session_id, doc_hash, doc_name[:200], len(questions), difficulty,
                 json.dumps(topics[:MAX_TOPICS]), limit, stamp(now), stamp(now + timedelta(seconds=limit)), len(questions)))
            for i, q in enumerate(questions):
                self.store.execute(
                    "INSERT INTO exam_questions (exam_id, idx, question, options_json, correct_answer, explanation, "
                    "concept, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (exam_id, i, q["question"], json.dumps(q["options"]), q["correct_answer"], q.get("explanation") or None,
                     q.get("concept") or "General", q.get("difficulty") or "medium"))
        return self.get(user_id, exam_id, now=now)

    # ── reading ──────────────────────────────────────────────────────────────
    def _row(self, user_id, exam_id) -> dict:
        row = self.store.fetchone("SELECT * FROM exams WHERE id = ? AND user_id = ?", (str(exam_id), int(user_id)))
        if not row:
            raise _exam_not_found()                     # someone else's exam looks exactly like a missing one
        return row

    def _questions(self, exam_id) -> List[dict]:
        qs = self.store.fetchall("SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY idx", (exam_id,))
        answers = {a["idx"]: a for a in self.store.fetchall("SELECT * FROM exam_answers WHERE exam_id = ?", (exam_id,))}
        for q in qs:
            q["options"] = json.loads(q["options_json"])
            a = answers.get(q["idx"])
            q["answer"] = a["answer"] if a else None
            q["flagged"] = bool(a and a["flagged"])
            q["is_correct"] = (None if not a or a["correct"] is None else bool(a["correct"]))
        return qs

    def get(self, user_id, exam_id, now: Optional[datetime] = None) -> dict:
        now = _now(now)
        row = self._row(user_id, exam_id)
        if row["status"] == "active" and now > datetime.fromisoformat(row["deadline"]) + GRACE:
            self._grade(user_id, row["id"], now=now, auto=True)            # time ran out: graded with what is saved
            row = self._row(user_id, exam_id)
        return self._public(row, self._questions(row["id"]), now)

    def _public(self, row: dict, qs: List[dict], now: datetime) -> dict:
        graded = row["status"] == "graded"
        out = {
            "id": row["id"], "status": row["status"], "session_id": row["session_id"], "doc_name": row["doc_name"],
            "length": row["length"], "difficulty": row["difficulty"], "topics": json.loads(row["topics_json"] or "[]"),
            "time_limit_s": row["time_limit_s"], "started_at": row["started_at"], "deadline": row["deadline"],
            "seconds_left": 0 if graded else max(0, int((datetime.fromisoformat(row["deadline"]) - now).total_seconds())),
            "answered": sum(1 for q in qs if q["answer"] is not None), "total": row["total"],
            "questions": [],
        }
        for q in qs:
            item = {"index": q["idx"], "question": q["question"], "options": q["options"], "answer": q["answer"],
                    "flagged": q["flagged"]}
            if graded:                                   # only now: the right answer, why, and what it tested
                item.update(correct_answer=q["correct_answer"], explanation=q["explanation"], concept=q["concept"],
                            difficulty=q["difficulty"], correct=bool(q["is_correct"]))
            out["questions"].append(item)
        if graded:
            out["result"] = {"score": row["score"], "total": row["total"], "accuracy": row["accuracy"],
                             "time_used_s": row["time_used_s"], "submitted_at": row["submitted_at"],
                             "auto_submitted": bool(row["auto_submitted"]), **json.loads(row["breakdown_json"] or "{}")}
        return out

    def history(self, user_id, limit: int = 20) -> List[dict]:
        rows = self.store.fetchall(
            "SELECT id, status, doc_name, session_id, length, difficulty, started_at, submitted_at, score, total, accuracy "
            "FROM exams WHERE user_id = ? ORDER BY started_at DESC LIMIT ?", (int(user_id), max(1, min(int(limit), 100))))
        return [{k: v for k, v in r.items() if k != "user_id"} for r in rows]

    # ── answering ────────────────────────────────────────────────────────────
    def answer(self, user_id, exam_id, index: int, *, answer: Optional[str] = None, clear: bool = False,
               flagged: Optional[bool] = None, now: Optional[datetime] = None) -> dict:
        now = _now(now)
        row = self._row(user_id, exam_id)
        if row["status"] != "active" or now > datetime.fromisoformat(row["deadline"]) + GRACE:
            self.get(user_id, exam_id, now=now)                            # (grades it if the time ran out)
            raise AppError("exam_closed", "This exam is over: answers can't be changed.", status_code=409)
        q = self.store.fetchone("SELECT * FROM exam_questions WHERE exam_id = ? AND idx = ?", (row["id"], int(index)))
        if not q:
            raise AppError("question_not_found", "That question isn't part of this exam.", status_code=404)
        current = self.store.fetchone("SELECT * FROM exam_answers WHERE exam_id = ? AND idx = ?", (row["id"], int(index)))
        picked = current["answer"] if current else None
        if clear:
            picked = None
        elif answer is not None:
            picked = next((o for o in json.loads(q["options_json"]) if same_answer(o, answer)), None)
            if picked is None:
                raise AppError("invalid_answer", "Pick one of the answer options.", status_code=400)
        flag = int(flagged) if flagged is not None else (current["flagged"] if current else 0)
        self.store.execute(
            "INSERT INTO exam_answers (exam_id, idx, answer, flagged, answered_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(exam_id, idx) DO UPDATE SET answer = excluded.answer, flagged = excluded.flagged, "
            "answered_at = excluded.answered_at",
            (row["id"], int(index), picked, flag, stamp(now)))
        answered = self.store.fetchone("SELECT COUNT(*) AS n FROM exam_answers WHERE exam_id = ? AND answer IS NOT NULL",
                                       (row["id"],))["n"]
        return {"ok": True, "index": int(index), "answer": picked, "flagged": bool(flag), "answered": int(answered),
                "seconds_left": max(0, int((datetime.fromisoformat(row["deadline"]) - now).total_seconds()))}

    # ── grading ──────────────────────────────────────────────────────────────
    def submit(self, user_id, exam_id, now: Optional[datetime] = None) -> dict:
        now = _now(now)
        row = self._row(user_id, exam_id)
        rewards = None
        if row["status"] == "active":
            rewards = self._grade(user_id, row["id"], now=now,
                                  auto=now > datetime.fromisoformat(row["deadline"]) + GRACE)
        out = self.get(user_id, exam_id, now=now)
        out["rewards"] = rewards
        return out

    @staticmethod
    def breakdown(qs: List[dict]) -> dict:
        """Per concept (weakest first) and per difficulty: right / total / accuracy."""
        def group(key):
            g = {}
            for q in qs:
                b = g.setdefault(q[key], {"correct": 0, "total": 0})
                b["total"] += 1
                b["correct"] += int(bool(q["is_correct"]))
            return [{key: k, **v, "accuracy": round(v["correct"] / v["total"], 4)} for k, v in g.items()]
        concepts = sorted(group("concept"), key=lambda c: (c["accuracy"], -c["total"], c["concept"]))
        order = {"easy": 0, "medium": 1, "hard": 2}
        levels = sorted(group("difficulty"), key=lambda d: order.get(d["difficulty"], 9))
        return {"concepts": concepts, "difficulties": levels,
                "unanswered": sum(1 for q in qs if q["answer"] is None),
                "weak_concepts": [c["concept"] for c in concepts if c["accuracy"] < 0.6][:5]}

    def _grade(self, user_id, exam_id: str, *, now: datetime, auto: bool) -> Optional[dict]:
        row = self._row(user_id, exam_id)
        qs = self._questions(exam_id)
        with self.store.transaction():
            for q in qs:
                q["is_correct"] = q["answer"] is not None and same_answer(q["answer"], q["correct_answer"])
                self.store.execute(
                    "INSERT INTO exam_answers (exam_id, idx, answer, flagged, correct, answered_at) VALUES (?, ?, ?, 0, ?, ?) "
                    "ON CONFLICT(exam_id, idx) DO UPDATE SET correct = excluded.correct",
                    (exam_id, q["idx"], q["answer"], int(q["is_correct"]), stamp(now)))
            score = sum(1 for q in qs if q["is_correct"])
            deadline = datetime.fromisoformat(row["deadline"])
            used = int((min(now, deadline) - datetime.fromisoformat(row["started_at"])).total_seconds())
            won = self.store.execute(
                "UPDATE exams SET status = 'graded', submitted_at = ?, score = ?, accuracy = ?, time_used_s = ?, "
                "breakdown_json = ?, auto_submitted = ? WHERE id = ? AND status = 'active'",
                (stamp(now), score, round(score / max(1, len(qs)), 4), max(0, used), json.dumps(self.breakdown(qs)),
                 int(auto), exam_id))
            if won != 1:
                return None                                         # graded by someone else (a second tab)
            if self.mastery is not None:                            # every question counts; a miss joins the review queue
                for q in qs:
                    self.mastery.record(user_id, row["doc_hash"], q["concept"], q["is_correct"], source="exam",
                                        question={"question": q["question"], "correct_answer": q["correct_answer"],
                                                  "explanation": q["explanation"]})
        rewards = None
        if self.rewards is not None and any(q["answer"] is not None for q in qs):
            rewards = self.rewards.award(str(user_id), "exam_complete", accuracy=score / max(1, len(qs)),
                                         difficulty={"easy": 1.0, "medium": 1.25, "hard": 1.5, "mixed": 1.25}[row["difficulty"]],
                                         source_id=f"exam:{exam_id}")
            if self.quests is not None and rewards and rewards.get("ok"):
                self.quests.on_action(str(user_id), "exam_complete")
        return rewards
