"""The spaced-repetition review queue (Phase 3 Stage 3A, docs/study-power.md): one FSRS queue per user, fed by
graded flashcards and every missed arena / quiz / exam question; plan-gated; grades move streaks, quests and
concept mastery."""
from datetime import datetime, timedelta, timezone

import pytest
from fsrs import Scheduler

import state
from services import entitlements
from services.review_service import LEARN_AHEAD, NEW_PER_DAY, ReviewService, stamp, upsert_item
from test_api import upload

SID = "55555555-5555-4555-8555-555555555555"
T0 = datetime(2026, 11, 4, 9, 0, tzinfo=timezone.utc)


@pytest.fixture()
def student(make_user, pdf_bytes):
    c, uid = make_user()
    assert upload(c, SID, pdf_bytes).status_code == 202
    doc_hash = state.mastery_service.doc_hash_for(SID, uid)
    return c, uid, doc_hash


@pytest.fixture()
def svc():
    """The real service with unfuzzed intervals, so the numbers are exact."""
    return ReviewService(state.store, mastery=state.mastery_service, scheduler=Scheduler(enable_fuzzing=False))


def _card(i, concept="ATP"):
    return {"front": f"Question {i}?", "back": f"Answer {i}", "explanation": f"Because {i}.", "concept": concept}


def _items(uid):
    return state.store.fetchall("SELECT * FROM review_items WHERE user_id = ? ORDER BY id", (int(uid),))


# ═════════════════════════ entering the queue ═══════════════════════════════
def test_a_missed_arena_quiz_or_exam_question_becomes_a_card_once(student):
    c, uid, h = student
    for source in ("arena", "quiz", "exam"):
        state.mastery_service.record(uid, h, "Mitosis", False, source=source,
                                     question={"question": f"What is {source}?", "correct_answer": "x", "explanation": "e"})
    state.mastery_service.record(uid, h, "Mitosis", False, source="arena",
                                 question={"question": "  what IS   arena? ", "correct_answer": "x"})     # same card
    state.mastery_service.record(uid, h, "Mitosis", True, source="arena",
                                 question={"question": "Right answers?", "correct_answer": "x"})          # not a miss
    rows = _items(uid)
    assert [(r["source"], r["front"], r["reps"]) for r in rows] == [
        ("arena", "What is arena?", 0), ("quiz", "What is quiz?", 0), ("exam", "What is exam?", 0)]
    assert rows[0]["concept"] == "Mitosis" and rows[0]["explanation"] == "e"


def test_a_scheduled_card_missed_again_elsewhere_comes_due_now(student, svc):
    c, uid, h = student
    item = upsert_item(state.store, uid, h, front="Q?", back="A", source="quiz", now=T0)
    svc.grade(uid, item, 4, now=T0)                                                   # Easy: days away
    assert _items(uid)[0]["due"] > stamp(T0 + timedelta(days=2))
    upsert_item(state.store, uid, h, front="Q?", back="A", source="arena", now=T0 + timedelta(hours=1))
    row = _items(uid)[0]
    assert row["due"] == stamp(T0 + timedelta(hours=1)) and row["reps"] == 1 and row["source"] == "quiz"


def test_unusable_cards_are_skipped(student):
    c, uid, h = student
    assert upsert_item(state.store, uid, h, front="  ", back="A", source="quiz") is None
    assert upsert_item(state.store, uid, h, front="Q", back="", source="quiz") is None
    assert upsert_item(state.store, uid, h, front="Q", back="A", source="nope") is None
    assert _items(uid) == []


# ═════════════════════════ FSRS scheduling ══════════════════════════════════
def test_grading_schedules_with_fsrs_and_logs_the_review(student, svc):
    c, uid, h = student
    item = upsert_item(state.store, uid, h, front="Q?", back="A", source="quiz", now=T0)
    out = svc.grade(uid, item, 3, now=T0)["item"]                                     # Good on a new card: 10 min step
    assert out["state"] == "learning" and out["reps"] == 1 and out["due"] == stamp(T0 + timedelta(minutes=10))
    out = svc.grade(uid, item, 3, reps=1, now=T0 + timedelta(minutes=10))["item"]     # graduates: days
    assert out["state"] == "review" and out["due"] >= stamp(T0 + timedelta(days=1))
    logs = state.store.fetchall("SELECT rating, was_new FROM review_logs WHERE user_id = ? ORDER BY id", (int(uid),))
    assert [(r["rating"], r["was_new"]) for r in logs] == [(3, 1), (3, 0)]


def test_a_lapse_is_counted_and_relearned(student, svc):
    c, uid, h = student
    item = upsert_item(state.store, uid, h, front="Q?", back="A", source="quiz", now=T0)
    svc.grade(uid, item, 4, now=T0)
    due = datetime.fromisoformat(_items(uid)[0]["due"])
    out = svc.grade(uid, item, 1, now=due)["item"]
    assert out["state"] == "relearning" and out["lapses"] == 1 and out["due"] == stamp(due + timedelta(minutes=10))


def test_the_buttons_show_the_next_interval_for_each_grade(student, svc):
    c, uid, h = student
    upsert_item(state.store, uid, h, front="Q?", back="A", source="quiz", now=T0)
    iv = svc.queue(uid, now=T0)[0]["intervals"]
    assert iv == {"1": 60, "2": 330, "3": 600, "4": 8 * 86400}
    assert iv["1"] < iv["2"] < iv["3"] < iv["4"]


def test_a_double_submit_is_refused_not_counted_twice(student, svc):
    c, uid, h = student
    item = upsert_item(state.store, uid, h, front="Q?", back="A", source="quiz", now=T0)
    svc.grade(uid, item, 3, reps=0, now=T0)
    with pytest.raises(Exception) as e:
        svc.grade(uid, item, 3, reps=0, now=T0)
    assert getattr(e.value, "code", "") == "review_stale" and e.value.status_code == 409
    assert len(state.store.fetchall("SELECT 1 FROM review_logs WHERE user_id = ?", (int(uid),))) == 1


def test_grades_count_for_the_concepts_mastery(student, svc):
    c, uid, h = student
    a = upsert_item(state.store, uid, h, front="Q1?", back="A", concept="Osmosis", source="quiz", now=T0)
    b = upsert_item(state.store, uid, h, front="Q2?", back="A", concept="Osmosis", source="quiz", now=T0)
    svc.grade(uid, a, 1, now=T0)                                                      # Again = a miss
    r = svc.grade(uid, b, 2, now=T0)                                                  # Hard = recalled
    assert r["mastery"] == {"concept": "Osmosis", "seen": 2, "correct": 1, "wrong_streak": 0}


# ═════════════════════════ the queue ════════════════════════════════════════
def test_queue_order_learning_then_due_reviews_then_new_and_nothing_early(student, svc):
    c, uid, h = student
    ids = [upsert_item(state.store, uid, h, front=f"Q{i}?", back="A", source="quiz", now=T0 + timedelta(seconds=i))
           for i in range(4)]
    svc.grade(uid, ids[0], 4, now=T0)                                  # review, due in 8 days: not shown now
    svc.grade(uid, ids[1], 3, now=T0)                                  # learning, due in 10 min: shown (learn ahead)
    svc.grade(uid, ids[2], 4, now=T0 - timedelta(days=30))             # review, overdue
    now = T0 + timedelta(minutes=1)
    assert [i["id"] for i in svc.queue(uid, now=now)] == [ids[1], ids[2], ids[3]]
    assert [i["state"] for i in svc.queue(uid, now=now)] == ["learning", "review", "new"]
    assert LEARN_AHEAD >= timedelta(minutes=10)


def test_new_cards_are_limited_per_day(student, svc):
    c, uid, h = student
    for i in range(NEW_PER_DAY + 5):
        upsert_item(state.store, uid, h, front=f"Q{i}?", back="A", source="quiz", now=T0)
    now = T0 + timedelta(minutes=1)
    assert svc.stats(uid, now=now)["new"] == NEW_PER_DAY and svc.stats(uid, now=now)["new_waiting"] == NEW_PER_DAY + 5
    for item in svc.queue(uid, limit=3, now=now):
        svc.grade(uid, item["id"], 4, now=now)
    s = svc.stats(uid, now=now)
    assert (s["new_left_today"], s["new"], s["reviewed_today"]) == (NEW_PER_DAY - 3, NEW_PER_DAY - 3, 3)
    assert len(svc.queue(uid, limit=100, now=now)) == NEW_PER_DAY - 3


def test_stats_count_sources_and_the_next_due_time(student, svc):
    c, uid, h = student
    upsert_item(state.store, uid, h, front="A?", back="1", source="arena", now=T0)
    item = upsert_item(state.store, uid, h, front="B?", back="2", source="flashcard", now=T0)
    svc.grade(uid, item, 4, now=T0)
    s = svc.stats(uid, now=T0)
    assert s["by_source"] == {"flashcard": 1, "arena": 1, "quiz": 0, "exam": 0} and s["total"] == 2
    assert s["due"] == 1 and s["next_due_at"] == _items(uid)[1]["due"]


def test_one_queue_across_documents_but_it_can_be_narrowed(student, svc):
    c, uid, h = student
    upsert_item(state.store, uid, h, front="Here?", back="1", source="quiz", now=T0)
    upsert_item(state.store, uid, "other-doc-hash", front="There?", back="2", source="quiz", now=T0)
    assert len(svc.queue(uid, now=T0)) == 2
    only = svc.queue(uid, doc_hash=h, now=T0)
    assert [i["front"] for i in only] == ["Here?"] and only[0]["document"]["session_id"] == SID
    assert only[0]["document"]["name"]


def test_cards_are_private(student, svc, make_user):
    c, uid, h = student
    item = upsert_item(state.store, uid, h, front="Q?", back="A", source="quiz", now=T0)
    _, other = make_user()
    with pytest.raises(Exception) as e:
        svc.grade(other, item, 3, now=T0)
    assert e.value.status_code == 404
    assert svc.queue(other, now=T0) == []


# ═════════════════════════ API ══════════════════════════════════════════════
def _miss(uid, h, n=1):
    for i in range(n):
        state.mastery_service.record(uid, h, "ATP", False, source="quiz",
                                     question={"question": f"Missed {i}?", "correct_answer": f"A{i}"})


def test_api_queue_grade_stats_and_the_daily_clear_reward(student):
    c, uid, h = student
    _miss(uid, h, 2)
    assert c.get("/review/stats").json()["due"] == 2
    q = c.get("/review/queue").json()
    assert [i["front"] for i in q["items"]] == ["Missed 0?", "Missed 1?"] and q["stats"]["locked"] is False
    first = q["items"][0]
    r = c.post("/review/grade", json={"item_id": first["id"], "rating": 4, "reps": first["reps"], "duration_ms": 4200})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["item"]["state"] == "review" and body["stats"]["due"] == 1 and body.get("rewards") is None
    assert c.post("/review/grade", json={"item_id": first["id"], "rating": 4, "reps": 0}).status_code == 409
    last = q["items"][1]
    body = c.post("/review/grade", json={"item_id": last["id"], "rating": 4, "reps": 0}).json()
    assert body["stats"]["due"] == 0 and body["rewards"]["ok"] is True                # queue cleared: paid once a day
    assert body["rewards"]["action_type"] == "review_complete" or body["rewards"].get("xp_gained", 0) > 0
    _miss(uid, h, 1)                                                                   # more work, cleared again
    item = c.get("/review/queue").json()["items"][0]
    again = c.post("/review/grade", json={"item_id": item["id"], "rating": 4, "reps": 0}).json()
    assert again.get("rewards") is None                                                    # not twice in one day


def test_api_grades_feed_streak_and_quests(student, monkeypatch):
    c, uid, h = student
    # Today's three quests are drawn at random: draw the two this test is about (it failed now and then before).
    wanted = ("review_cards", "maintain_streak")
    monkeypatch.setattr("services.progression.quest_service.random.sample",
                        lambda pool, k: sorted(pool, key=lambda q: q["quest_type"] not in wanted)[:k])
    _miss(uid, h, 1)
    state.store.update_progress_fields(str(uid), {"streak_days": 0, "last_active_utc": None})
    item = c.get("/review/queue").json()["items"][0]
    c.post("/review/grade", json={"item_id": item["id"], "rating": 3, "reps": 0})
    assert state.store.get_progress(str(uid))["streak_days"] >= 1
    today = state.store.user_today(str(uid)).isoformat()
    quests = {q["quest_type"]: q for q in state.store.get_daily_quests(str(uid), today)}
    assert quests["review_cards"]["current_count"] == 1
    assert quests["maintain_streak"]["current_count"] >= 1


def test_api_add_deck_and_remove_a_card(student):
    c, uid, h = student
    cards = [_card(i) for i in range(3)] + [_card(0), {"front": " ", "back": "x"}]
    r = c.post("/review/cards", json={"session_id": SID, "cards": cards}).json()
    assert (r["added"], r["existing"], r["skipped"]) == (3, 1, 1) and r["stats"]["by_source"]["flashcard"] == 3
    assert c.post("/review/cards", json={"session_id": SID, "cards": []}).status_code == 422
    item = c.get("/review/queue").json()["items"][0]
    assert c.delete(f"/review/cards/{item['id']}").json() == {"ok": True}
    assert c.delete(f"/review/cards/{item['id']}").status_code == 404
    assert c.get("/review/stats").json()["total"] == 2


def test_api_flashcard_grading_adds_the_card_with_its_first_review(student):
    c, uid, h = student
    body = {"session_id": SID, "concept": "ATP", "correct": True, **{k: v for k, v in _card(7).items() if k != "concept"}}
    r = c.post("/study/flashcards/review", json=body).json()
    assert r["review_item"]["source"] == "flashcard" and r["review_item"]["reps"] == 1 and r["review_item"]["state"] == "learning"
    r = c.post("/study/flashcards/review", json={**body, "correct": False}).json()      # practice: schedule kept
    assert r["review_item"]["reps"] == 1 and r["mastery"]["seen"] == 2
    old = c.post("/study/flashcards/review", json={"session_id": SID, "concept": "ATP", "correct": True}).json()
    assert old.get("review_item") is None                                               # older clients: mastery only


def test_api_quiz_misses_land_in_the_queue(student, monkeypatch):
    c, uid, h = student
    questions = [{"id": 1, "question": "Q1?", "options": ["a", "b"], "correct_answer": "a", "explanation": "e", "concept": "Mitosis"}]

    async def fake_quiz(context, num_questions, question_type):
        return {"questions": [dict(q) for q in questions]}
    monkeypatch.setattr("routers.study.generate_quiz_async", fake_quiz)
    qid = c.post("/quiz", json={"topic": "mitosis", "num_questions": 1, "question_type": "MCQ", "session_id": SID}).json()["quiz_id"]
    c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "b"})
    items = c.get("/review/queue").json()["items"]
    assert [(i["source"], i["front"], i["back"]) for i in items] == [("quiz", "Q1?", "a")]


# ═════════════════════════ plans ════════════════════════════════════════════
def test_entitlements_follow_the_plan_and_lock_the_queue(student, monkeypatch):
    c, uid, h = student
    assert c.get("/entitlements").json()["tier"] == "archmage"                         # the stub's default
    monkeypatch.setenv("DEFAULT_TIER", "apprentice")
    e = c.get("/entitlements").json()
    assert e["tier"] == "apprentice" and e["features"]["review_queue"] == {
        "enabled": False, "name": "Spaced-repetition review", "required_tier": "scholar", "required_tier_name": "Scholar"}
    _miss(uid, h, 1)
    r = c.get("/review/queue")
    assert r.status_code == 403 and r.json()["error"]["code"] == "feature_locked"
    assert r.json()["error"]["details"] == {"feature": "review_queue", "tier": "apprentice", "required_tier": "scholar",
                                            "required_tier_name": "Scholar"}
    assert c.post("/review/grade", json={"item_id": 1, "rating": 3}).status_code == 403
    assert c.post("/review/cards", json={"session_id": SID, "cards": [_card(1)]}).status_code == 403
    s = c.get("/review/stats").json()
    assert s["locked"] is True and s["due"] == 1                                        # the badge still counts
    monkeypatch.setenv("DEFAULT_TIER", "scholar")
    assert c.get("/review/queue").status_code == 200
    assert entitlements.has("scholar", "exam_mode") is False and entitlements.has("sage", "exam_mode") is True
    monkeypatch.setenv("DEFAULT_TIER", "bogus")
    assert entitlements.default_tier() == "archmage"


def test_review_endpoints_need_a_login(client):
    for method, path in (("get", "/review/stats"), ("get", "/review/queue"), ("get", "/entitlements"),
                         ("post", "/review/grade"), ("post", "/review/cards"), ("delete", "/review/cards/1")):
        assert getattr(client, method)(path).status_code in (401, 422), path
