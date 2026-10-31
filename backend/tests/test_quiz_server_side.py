"""Quiz rewards are decided by the server: it keeps the correct answers, grades each answer itself and
pays out once per quiz. Nothing the browser reports can earn a reward."""
import json
import threading

import pytest

import state
from test_api import upload

SID = "44444444-4444-4444-8444-444444444444"
QUIZ_REQ = {"topic": "mitosis", "num_questions": 3, "question_type": "MCQ", "session_id": SID}
QUESTIONS = [
    {"id": 1, "question": "Q1?", "options": ["a", "b", "c", "d"], "correct_answer": "a", "explanation": "because a"},
    {"id": 2, "question": "Q2?", "options": ["w", "x", "y", "z"], "correct_answer": "x", "explanation": "because x"},
    {"id": 3, "question": "Q3?", "options": ["True", "False"], "correct_answer": "False", "explanation": "because false"},
]


@pytest.fixture()
def quiz_client(make_user, pdf_bytes, monkeypatch):
    c, uid = make_user()
    assert upload(c, SID, pdf_bytes).status_code == 202

    async def fake_quiz(context, num_questions, question_type):
        return {"questions": [dict(q) for q in QUESTIONS]}
    monkeypatch.setattr("routers.study.generate_quiz_async", fake_quiz)
    return c, uid


def _new_quiz(c):
    r = c.post("/quiz", json=QUIZ_REQ)
    assert r.status_code == 200, r.text
    return r.json()


def _events(uid, kind="quiz_complete"):
    return state.store.fetchall("SELECT * FROM reward_events WHERE user_id = ? AND kind = ?", (str(uid), kind))


def _xp(c):
    return c.get("/profile").json()["progress"]["total_xp"]


# ── the browser never gets the answers up front ──────────────────────────────
def test_generated_quiz_has_no_correct_answers_or_explanations(quiz_client):
    c, _ = quiz_client
    data = _new_quiz(c)
    assert data["quiz_id"]
    raw = json.dumps(data)
    for q in data["content"]["questions"]:
        assert "correct_answer" not in q and "explanation" not in q
        assert q["options"]
    assert "because" not in raw
    stored = state.store.fetchone("SELECT questions_json FROM quizzes WHERE id = ?", (data["quiz_id"],))
    assert "correct_answer" in stored["questions_json"]          # ... but the server kept them


def test_every_generation_gets_its_own_quiz_id_even_when_the_content_is_cached(quiz_client):
    c, _ = quiz_client
    assert _new_quiz(c)["quiz_id"] != _new_quiz(c)["quiz_id"]


# ── per-question feedback ────────────────────────────────────────────────────
def test_answer_endpoint_gives_instant_feedback(quiz_client):
    c, _ = quiz_client
    qid = _new_quiz(c)["quiz_id"]
    right = c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "a"}).json()
    assert right["correct"] is True and right["correct_answer"] == "a" and right["explanation"] == "because a"
    wrong = c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 2, "answer": "w"}).json()
    assert wrong["correct"] is False and wrong["correct_answer"] == "x" and wrong["explanation"] == "because x"


def test_the_first_answer_to_a_question_is_final(quiz_client):
    c, _ = quiz_client
    qid = _new_quiz(c)["quiz_id"]
    first = c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "b"}).json()
    again = c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "a"}).json()
    assert first["correct"] is False and again["correct"] is False and again["answer"] == "b"


def test_answer_validation(quiz_client):
    c, _ = quiz_client
    qid = _new_quiz(c)["quiz_id"]
    assert c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 99, "answer": "a"}).status_code == 404
    assert c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "not an option"}).status_code == 400
    assert c.post("/quiz/answer", json={"quiz_id": "nope", "question_id": 1, "answer": "a"}).status_code == 404


# ── finishing awards once ────────────────────────────────────────────────────
def _answer_all(c, qid, picks=("a", "x", "False")):
    for question, pick in zip(QUESTIONS, picks):
        assert c.post("/quiz/answer", json={"quiz_id": qid, "question_id": question["id"], "answer": pick}).status_code == 200


def test_finish_computes_accuracy_on_the_server_and_awards_once(quiz_client):
    c, uid = quiz_client
    qid = _new_quiz(c)["quiz_id"]
    _answer_all(c, qid, picks=("a", "x", "True"))                   # 2 of 3 right
    done = c.post("/quiz/finish", json={"quiz_id": qid}).json()
    assert (done["score"], done["total"]) == (2, 3) and done["accuracy"] == pytest.approx(2 / 3)
    assert done["already_finished"] is False and done["rewards"]["ok"] is True
    events = _events(uid)
    assert len(events) == 1 and events[0]["xp"] == done["rewards"]["xp_gained"] > 0   # the ledger holds the award
    assert events[0]["source_id"] == qid


def test_replaying_the_submission_awards_nothing(quiz_client):
    c, uid = quiz_client
    qid = _new_quiz(c)["quiz_id"]
    _answer_all(c, qid)
    assert c.post("/quiz/finish", json={"quiz_id": qid}).json()["rewards"]["ok"] is True
    xp, coins, events = _xp(c), c.get("/profile").json()["progress"]["coins"], len(_events(uid))

    for _ in range(3):                                              # replay the finish ...
        again = c.post("/quiz/finish", json={"quiz_id": qid}).json()
        assert again["already_finished"] is True and again["rewards"] is None and again["score"] == 3
    for question, pick in zip(QUESTIONS, ("a", "x", "False")):      # ... and the answers
        assert c.post("/quiz/answer", json={"quiz_id": qid, "question_id": question["id"], "answer": pick}).status_code == 200
    assert c.post("/quiz/finish", json={"quiz_id": qid}).json()["rewards"] is None

    assert _xp(c) == xp and c.get("/profile").json()["progress"]["coins"] == coins
    assert len(_events(uid)) == events == 1


def test_concurrent_finishes_award_exactly_once(quiz_client):
    c, uid = quiz_client
    qid = _new_quiz(c)["quiz_id"]
    _answer_all(c, qid)
    from services.quiz_service import QuizService  # noqa: F401
    results, barrier = [], threading.Barrier(8)

    def run():
        barrier.wait()
        results.append(state.quiz_service.finish(str(uid), qid))
    threads = [threading.Thread(target=run) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sum(1 for r in results if r["rewards"] and r["rewards"].get("ok")) == 1
    assert len(_events(uid)) == 1


def test_cannot_finish_before_answering_everything(quiz_client):
    c, uid = quiz_client
    qid = _new_quiz(c)["quiz_id"]
    c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "a"})
    r = c.post("/quiz/finish", json={"quiz_id": qid})
    assert r.status_code == 400 and r.json()["error"]["code"] == "quiz_incomplete"
    assert _events(uid) == []


def test_accuracy_cannot_be_chosen_by_the_client(quiz_client):
    c, uid = quiz_client
    qid = _new_quiz(c)["quiz_id"]
    _answer_all(c, qid, picks=("b", "w", "True"))                    # everything wrong
    r = c.post("/quiz/finish", json={"quiz_id": qid, "accuracy": 1.0, "score": 3})
    assert r.json()["score"] == 0 and r.json()["accuracy"] == 0


# ── other people's quizzes ───────────────────────────────────────────────────
def test_a_quiz_belongs_to_the_user_who_generated_it(quiz_client, make_user):
    c, uid = quiz_client
    qid = _new_quiz(c)["quiz_id"]
    other, other_uid = make_user()
    assert other.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "a"}).status_code == 404
    assert other.post("/quiz/finish", json={"quiz_id": qid}).status_code == 404
    assert _events(other_uid) == []


def test_quiz_endpoints_need_a_login(quiz_client, client):
    assert client.post("/quiz/answer", json={"quiz_id": "x", "question_id": 1, "answer": "a"}).status_code == 401
    assert client.post("/quiz/finish", json={"quiz_id": "x"}).status_code == 401


# ── /rewards/award no longer pays for anything ───────────────────────────────
@pytest.mark.parametrize("action", ["quiz_complete", "arena_round_complete", "boss_defeat",
                                    "chat_bundle_5", "notes_generation", "flashcard_complete"])
def test_rewards_award_endpoint_awards_nothing(make_user, action):
    c, uid = make_user()
    before = _xp(c)
    r = c.post("/rewards/award", json={"action_type": action, "accuracy": 1.0, "difficulty": 9.0, "combo_count": 99})
    assert r.status_code == 403 and r.json()["error"]["code"] == "reward_not_claimable"
    assert _xp(c) == before
    assert _events(uid, action) == []


def test_rewards_award_still_rejects_unknown_actions(make_user):
    c, _ = make_user()
    assert c.post("/rewards/award", json={"action_type": "free_money"}).status_code == 400
