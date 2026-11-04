"""Exam mode (Phase 3 Stage 3A, docs/study-power.md): a timed mock test written from the document, graded once on
the server, with a per-concept breakdown and a PDF report; misses feed the review queue; plan-gated (Sage+)."""
import io
from datetime import datetime, timedelta, timezone

import pytest
from pypdf import PdfReader

import state
from core_brains import exam_brain
from core_brains.llm_schemas import BattleQuiz
from test_api import upload

SID = "66666666-6666-4666-8666-666666666666"


def _qs(n, concept=lambda i: ["Osmosis", "Diffusion", "ATP"][i % 3]):
    return [{"question": f"Exam question {i}?", "options": [f"right {i}", f"wrong {i}a", f"wrong {i}b", f"wrong {i}c"],
             "correct_answer": f"right {i}", "explanation": f"Because {i}.", "concept": concept(i),
             "difficulty": ["easy", "medium", "hard"][i % 3]} for i in range(n)]


class FakeWriter:
    def __init__(self):
        self.calls = []
        self.n = None

    async def __call__(self, vector_store, *, length, difficulty, topics=None):
        self.calls.append({"length": length, "difficulty": difficulty, "topics": topics})
        return _qs(self.n if self.n is not None else length)


@pytest.fixture()
def writer(monkeypatch):
    w = FakeWriter()
    monkeypatch.setattr("routers.exams.generate_exam_async", w)
    return w


@pytest.fixture()
def student(make_user, pdf_bytes, writer):
    c, uid = make_user()
    assert upload(c, SID, pdf_bytes).status_code == 202
    return c, uid


def _start(c, **kw):
    r = c.post("/exams", json={"session_id": SID, "length": 10, "difficulty": "mixed", **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _answer(c, exam, i, answer=None, **kw):
    return c.post(f"/exams/{exam['id']}/answers", json={"index": i, "answer": answer, **kw})


def _expire(exam_id):
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(microsecond=0).isoformat()
    state.store.execute("UPDATE exams SET deadline = ? WHERE id = ?", (past, exam_id))


# ═════════════════════════ writing and starting ═════════════════════════════
def test_an_exam_starts_with_its_clock_and_no_answers_or_hints_in_sight(student, writer):
    c, _ = student
    e = _start(c, length=20, difficulty="hard", topics=["Osmosis", " osmosis ", "ATP"])
    assert writer.calls == [{"length": 20, "difficulty": "hard", "topics": ["Osmosis", "ATP"]}]   # deduplicated
    assert e["status"] == "active" and e["total"] == 20 and e["time_limit_s"] == 20 * 90
    assert 20 * 90 - 5 <= e["seconds_left"] <= 20 * 90 and e["answered"] == 0 and e["topics"] == ["Osmosis", "ATP"]
    q = e["questions"][0]
    assert set(q) == {"index", "question", "options", "answer", "flagged"}                        # no answer, hint, concept
    assert "result" not in e


def test_one_exam_at_a_time_and_a_refresh_resumes_it(student, writer):
    c, _ = student
    e = _start(c)
    r = c.post("/exams", json={"session_id": SID, "length": 10})
    assert r.status_code == 409 and r.json()["error"]["details"] == {"exam_id": e["id"]}
    assert len(writer.calls) == 1                                                                   # no LLM call wasted
    assert c.get("/exams/active").json()["exam"]["id"] == e["id"]


def test_too_few_usable_questions_is_a_retry_not_an_exam(student, writer):
    c, _ = student
    writer.n = 4                                                                                    # 4 of 10
    r = c.post("/exams", json={"session_id": SID, "length": 10})
    assert r.status_code == 503 and r.json()["error"]["code"] == "generation_failed" and r.json()["error"]["action"] == "retry"
    assert c.get("/exams/active").json().get("exam") is None
    writer.n = 7                                                                                    # 7 of 10 is enough
    assert _start(c)["total"] == 7


def test_requests_are_checked(student):
    c, _ = student
    assert c.post("/exams", json={"session_id": SID, "length": 15}).status_code == 422
    assert c.post("/exams", json={"session_id": SID, "difficulty": "nightmare"}).status_code == 422
    assert c.post("/exams", json={"session_id": SID, "topics": ["a"] * 6}).status_code == 422
    assert c.post("/exams", json={"session_id": SID, "topics": ["x" * 500]}).status_code == 400


# ═════════════════════════ answering ════════════════════════════════════════
def test_answers_can_be_changed_cleared_and_flagged_until_submit(student):
    c, _ = student
    e = _start(c)
    assert _answer(c, e, 0, "wrong 0a").json()["answered"] == 1
    assert _answer(c, e, 0, "RIGHT 0").json()["answer"] == "right 0"                              # same option, any case
    r = _answer(c, e, 1, flagged=True).json()
    assert r["flagged"] is True and r["answer"] is None and r["answered"] == 1
    assert _answer(c, e, 0, clear=True).json()["answered"] == 0
    assert _answer(c, e, 2, "not an option").status_code == 400
    assert _answer(c, e, 99, "x").status_code == 404
    got = c.get(f"/exams/{e['id']}").json()
    assert got["questions"][1]["flagged"] is True and got["questions"][0]["answer"] is None


# ═════════════════════════ grading ══════════════════════════════════════════
def test_submit_grades_once_with_a_per_concept_breakdown(student):
    c, uid = student
    e = _start(c)
    for i in range(10):
        if i < 6:                                                                                   # 0..5 answered
            _answer(c, e, i, f"right {i}" if i % 3 != 0 else f"wrong {i}a")                         # Osmosis (0, 3) wrong
    r = c.post(f"/exams/{e['id']}/submit").json()
    res = r["result"]
    assert r["status"] == "graded" and (res["score"], res["total"], res["unanswered"]) == (4, 10, 4)
    assert res["accuracy"] == 0.4 and res["auto_submitted"] is False and 0 <= res["time_used_s"] <= 10
    assert res["concepts"][0] == {"concept": "Osmosis", "correct": 0, "total": 4, "accuracy": 0.0}  # weakest first
    assert {d["difficulty"] for d in res["difficulties"]} == {"easy", "medium", "hard"}
    assert res["weak_concepts"][0] == "Osmosis"
    q0 = r["questions"][0]
    assert (q0["correct"], q0["correct_answer"], q0["concept"], q0["explanation"]) == (False, "right 0", "Osmosis", "Because 0.")
    assert r["rewards"]["ok"] is True
    again = c.post(f"/exams/{e['id']}/submit").json()
    assert again["result"] == res and again.get("rewards") is None                                   # not graded / paid twice
    assert _answer(c, e, 9, "right 9").status_code == 409                                           # closed
    today = state.store.user_today(str(uid)).isoformat()
    assert {q["quest_type"]: q for q in state.store.get_daily_quests(str(uid), today)}.get(
        "complete_exams", {"current_count": 1})["current_count"] == 1


def test_missed_exam_questions_feed_the_review_queue_and_mastery(student):
    c, uid = student
    e = _start(c)
    _answer(c, e, 0, "wrong 0a")
    _answer(c, e, 1, "right 1")
    c.post(f"/exams/{e['id']}/submit")
    items = c.get("/review/queue?limit=50").json()["items"]
    fronts = {i["front"] for i in items}
    assert {i["source"] for i in items} == {"exam"} and len(items) == 9                              # 1 wrong + 8 unanswered
    assert "Exam question 1?" not in fronts and "Exam question 0?" in fronts
    m = state.store.fetchone("SELECT seen, correct FROM concept_mastery WHERE user_id = ? AND concept_key = 'diffusion'", (uid,))
    assert (m["seen"], m["correct"]) == (3, 1)


def test_time_running_out_grades_the_saved_answers(student):
    c, _ = student
    e = _start(c)
    _answer(c, e, 0, "right 0")
    _expire(e["id"])
    assert _answer(c, e, 1, "right 1").status_code == 409                                           # too late
    got = c.get(f"/exams/{e['id']}").json()
    assert got["status"] == "graded" and got["result"]["auto_submitted"] is True and got["result"]["score"] == 1
    assert got["result"]["time_used_s"] <= e["time_limit_s"]
    assert c.get("/exams/active").json().get("exam") is None
    assert _start(c)["status"] == "active"                                                          # a new one may start


def test_history_lists_the_users_exams(student):
    c, _ = student
    e = _start(c)
    c.post(f"/exams/{e['id']}/submit")
    h = c.get("/exams").json()["exams"]
    assert [(x["id"], x["status"], x["score"]) for x in h] == [(e["id"], "graded", 0)]


def test_exams_are_private(student, make_user):
    c, _ = student
    e = _start(c)
    other, _ = make_user()
    assert other.get(f"/exams/{e['id']}").status_code == 404
    assert other.post(f"/exams/{e['id']}/submit").status_code == 404
    assert other.get(f"/exams/{e['id']}/report.pdf").status_code == 404


# ═════════════════════════ PDF report ═══════════════════════════════════════
def test_the_pdf_report_shows_score_concepts_and_missed_questions(student):
    c, _ = student
    e = _start(c)
    assert c.get(f"/exams/{e['id']}/report.pdf").status_code == 409                                # not graded yet
    _answer(c, e, 1, "right 1")
    c.post(f"/exams/{e['id']}/submit")
    r = c.get(f"/exams/{e['id']}/report.pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith('attachment; filename="exam-report-')
    assert r.content.startswith(b"%PDF")
    text = " ".join(p.extract_text() for p in PdfReader(io.BytesIO(r.content)).pages)
    for needle in ("Exam score report", "1 / 10", "10%", "By concept", "Osmosis", "Questions to review (9)",
                   "Correct answer: right 0", "review queue"):
        assert needle in text, needle


# ═════════════════════════ plans and options ════════════════════════════════
def test_exam_mode_needs_the_sage_plan(student, monkeypatch):
    c, _ = student
    monkeypatch.setenv("DEFAULT_TIER", "scholar")
    r = c.post("/exams", json={"session_id": SID})
    assert r.status_code == 403 and r.json()["error"]["details"]["required_tier"] == "sage"
    for path in ("/exams/active", "/exams", f"/exams/options?session_id={SID}", "/exams/x", "/exams/x/report.pdf"):
        assert c.get(path).status_code == 403, path
    monkeypatch.setenv("DEFAULT_TIER", "sage")
    assert c.get("/exams/active").status_code == 200


def test_options_suggest_the_documents_concepts_weakest_first(student):
    c, uid = student
    h = state.mastery_service.doc_hash_for(SID, uid)
    for concept, correct in (("ATP", True), ("Osmosis", False), ("Osmosis", False), ("Diffusion", False)):
        state.mastery_service.record(uid, h, concept, correct)
    o = c.get(f"/exams/options?session_id={SID}").json()
    assert o["lengths"] == [10, 20, 30] and o["seconds_per_question"]["hard"] == 90 and o["max_topics"] == 5
    assert o["suggested_topics"] == ["Osmosis", "Diffusion", "ATP"]


def test_exam_endpoints_need_a_login(client):
    for method, path in (("post", "/exams"), ("get", "/exams/active"), ("get", "/exams"), ("get", "/exams/x"),
                         ("post", "/exams/x/answers"), ("post", "/exams/x/submit"), ("get", "/exams/x/report.pdf")):
        assert getattr(client, method)(path).status_code in (401, 422), path


# ═════════════════════════ writing the questions ════════════════════════════
def test_batches_cover_the_topics_or_different_angles_of_the_document():
    assert exam_brain._plan(30, []) == [("the whole document", q, 10) for q in exam_brain.BROAD_QUERIES[:3]]
    assert exam_brain._plan(10, ["A", "B", "C"]) == [("A", "A", 4), ("B", "B", 3), ("C", "C", 3)]
    assert sum(n for *_, n in exam_brain._plan(20, ["A"])) == 20


async def test_written_questions_are_deduplicated_and_checked(monkeypatch):
    async def fake_context(store, query, k=8):
        return f"context about {query}"

    batches = iter([
        [{"question": "Q1?", "options": ["a", "b", "c", "d"], "correct_answer": "a", "concept": "concept_1"},
         {"question": "q1 ?", "options": ["a", "b", "c", "d"], "correct_answer": "a", "concept": "X"},          # duplicate
         {"question": "Q2?", "options": ["a", "b", "c", "d"], "correct_answer": "z", "concept": "Y"}],          # bad answer
        [{"question": "Q3?", "options": ["a", "b", "c", "d"], "correct_answer": "b", "concept": "Z", "difficulty": "hard"}],
    ])

    async def fake_structured(messages, schema, **kw):
        return BattleQuiz.model_validate({"questions": next(batches)})
    monkeypatch.setattr(exam_brain, "_get_context_async", fake_context)
    monkeypatch.setattr(exam_brain, "generate_structured_async", fake_structured)
    out = await exam_brain.generate_exam_async(None, length=20, difficulty="mixed")
    assert [(q["question"], q["concept"], q["difficulty"]) for q in out] == [("Q1?", "General", "medium"), ("Q3?", "Z", "hard")]
