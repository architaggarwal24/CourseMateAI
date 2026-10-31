"""Concept mastery, Nemesis and the review deck (docs/arena-v2.md section 3): every graded answer - arena, quiz,
flashcard review - counts for its concept on that document; the weakest concepts make a Nemesis boss; the missed
questions become a review deck without any LLM call."""
from datetime import datetime, timedelta, timezone

import state
from test_api import upload
from arena_v2_support import (  # noqa: F401  (fixtures)
    SID, SID_OTHER, _clean_v2_tables, _plain_pacing, llm, intents, hero,
    start, question, truth, wrong, answer, play, wait, pool,
)
from conftest import make_pdf_bytes


def _mastery(uid, concept_key=None):
    sql = "SELECT * FROM concept_mastery WHERE user_id = ?" + (" AND concept_key = ?" if concept_key else "")
    return state.store.fetchall(sql, (uid,) + ((concept_key,) if concept_key else ()))


def _review(c, concept, correct, sid=SID):
    return c.post("/study/flashcards/review", json={"session_id": sid, "concept": concept, "correct": correct})


def _miss_three(c):
    for concept in ("Spindle fibres", "Anaphase", "Cytokinesis"):
        assert _review(c, concept, False).status_code == 200


# ═════════════════════════ writers ═══════════════════════════════════════════
def test_arena_answers_count_for_their_concept_once(hero, llm):
    c, uid = hero
    llm.tiers = ("medium",)
    llm.concept = lambda phase, n, i: "Spindle fibres" if i == 0 else f"other-{n}-{i}"
    bid = start(c)["battle_id"]
    q = question(c, bid)["question"]
    answer(c, bid, q["id"], wrong(q["options"], bid, q["id"]))
    answer(c, bid, q["id"], truth(bid, q["id"]))                            # a replay counts nothing
    m = _mastery(uid, "spindle fibres")
    assert len(m) == 1 and (m[0]["seen"], m[0]["correct"], m[0]["wrong_streak"]) == (1, 0, 1)
    assert m[0]["concept"] == "Spindle fibres" and m[0]["last_wrong_at"]
    missed = state.store.fetchall("SELECT * FROM missed_questions WHERE user_id = ?", (uid,))
    assert len(missed) == 1 and missed[0]["source"] == "arena" and missed[0]["correct_answer"] == truth(bid, q["id"])
    play(c, bid, True)
    assert sum(r["seen"] for r in _mastery(uid)) == 2


def test_a_right_answer_resets_the_wrong_streak(hero):
    c, uid = hero
    _review(c, "Anaphase", False)
    _review(c, "Anaphase", False)
    r = _review(c, "anaphase ", True).json()                                # same concept, any spelling
    assert r["mastery"] == {"concept": "anaphase", "seen": 3, "correct": 1, "wrong_streak": 0}


def test_flashcard_reviews_are_checked(hero, make_user):
    c, _ = hero
    assert _review(c, "", True).status_code == 400
    assert _review(c, "x" * 201, True).status_code == 400
    assert c.post("/study/flashcards/review", json={"session_id": SID, "concept": "A"}).status_code == 422
    stranger, _ = make_user()
    assert _review(stranger, "Anaphase", False).status_code in (403, 404)
    assert state.store.fetchall("SELECT 1 FROM concept_mastery") == []


def test_quiz_answers_count_once_and_keep_the_missed_question(hero, monkeypatch):
    c, uid = hero
    questions = [{"id": 1, "question": "Q1?", "options": ["a", "b", "c", "d"], "correct_answer": "a",
                  "explanation": "because a", "concept": "Prophase"},
                 {"id": 2, "question": "Q2?", "options": ["w", "x", "y", "z"], "correct_answer": "x",
                  "explanation": "because x"}]

    async def fake_quiz(context, num_questions, question_type):
        return {"questions": [dict(q) for q in questions]}
    monkeypatch.setattr("routers.study.generate_quiz_async", fake_quiz)
    qid = c.post("/quiz", json={"topic": "mitosis", "num_questions": 2, "question_type": "MCQ",
                                "session_id": SID}).json()["quiz_id"]
    c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "b"})
    c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 1, "answer": "a"})          # replay: nothing
    c.post("/quiz/answer", json={"quiz_id": qid, "question_id": 2, "answer": "w"})
    by_key = {r["concept_key"]: r for r in _mastery(uid)}
    assert (by_key["prophase"]["seen"], by_key["prophase"]["correct"]) == (1, 0)
    assert by_key["mitosis"]["seen"] == 1                                    # no concept: the quiz topic
    deck = c.get("/study/review-deck", params={"session_id": SID}).json()
    assert {card["front"] for card in deck["cards"]} == {"Q1?", "Q2?"}
    card = next(card for card in deck["cards"] if card["front"] == "Q1?")
    assert card["back"] == "a" and card["explanation"] == "because a" and card["source"] == "quiz"


# ═════════════════════════ weak concepts ═════════════════════════════════════
def test_weak_concepts_rank_misses_streak_and_recency(hero):
    c, uid = hero
    for _ in range(3):
        _review(c, "Old mistake", False)
    _review(c, "Old mistake", True)                                          # 3 misses, streak 0
    _review(c, "Fresh mistake", False)
    _review(c, "Fresh mistake", False)                                       # 2 misses, streak 2, now
    _review(c, "Known", True)                                                # never missed: not weak
    long_ago = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    state.store.execute("UPDATE concept_mastery SET last_wrong_at = ? WHERE concept_key = 'old mistake'", (long_ago,))
    body = c.get("/arena/weak-concepts", params={"session_id": SID}).json()
    assert [w["concept"] for w in body["concepts"]] == ["Fresh mistake", "Old mistake"]
    assert body["concepts"][0]["misses"] == 2 and body["concepts"][0]["wrong_streak"] == 2
    assert body["missed_total"] == 2 and body["nemesis_ready"] is False


def test_mastery_is_per_document_and_per_user(hero, make_user):
    c, _ = hero
    _miss_three(c)
    assert upload(c, SID_OTHER, make_pdf_bytes("Photosynthesis makes sugar from light. " * 40)).status_code == 202
    assert c.get("/arena/weak-concepts", params={"session_id": SID_OTHER}).json()["concepts"] == []
    assert c.get("/arena/weak-concepts", params={"session_id": SID}).json()["nemesis_ready"] is True
    stranger, _ = make_user()
    assert stranger.get("/arena/weak-concepts", params={"session_id": SID}).status_code in (403, 404)


# ═════════════════════════ Nemesis ═══════════════════════════════════════════
def test_nemesis_needs_three_missed_concepts(hero):
    c, _ = hero
    _review(c, "Anaphase", False)
    _review(c, "Prophase", False)
    r = c.post("/arena/battles", json={"session_id": SID, "mode": "nemesis", "difficulty": "hard"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_enough_data"
    assert r.json()["error"]["details"] == {"missed_concepts": 2, "needed": 3}
    assert state.store.fetchall("SELECT 1 FROM arena_battles") == []


def test_a_nemesis_is_built_from_the_weak_concepts_and_asks_about_them(hero, llm):
    c, _ = hero
    _miss_three(c)
    data = start(c, mode="nemesis", topic="")
    bid = data["battle_id"]
    assert data["battle"]["mode"] == "nemesis" and data["battle"]["topic"].startswith("Nemesis: ")
    assert set(data["boss"]["target_concepts"]) == {"Spindle fibres", "Anaphase", "Cytokinesis"}
    assert llm.persona_calls[-1][0] == data["battle"]["topic"]
    assert wait(lambda: pool(bid) > 0)
    targets = [kw.get("target_concepts") for _, _, kw in llm.calls]
    assert targets and all(set(t) == {"Spindle fibres", "Anaphase", "Cytokinesis"} for t in targets)
    # the same concept is asked again (different questions): a Nemesis does not dedupe by concept
    concepts = [r["concept_key"] for r in state.store.fetchall(
        "SELECT concept_key FROM arena_questions WHERE battle_id = ? AND phase = 1", (bid,))]
    assert len(concepts) > len(set(concepts))
    again = start(c, mode="nemesis", topic="")                               # a refresh resumes it
    assert again["resumed"] and again["battle_id"] == bid


def test_a_quick_battle_still_needs_a_topic(hero):
    c, _ = hero
    assert c.post("/arena/battles", json={"session_id": SID, "difficulty": "hard"}).status_code == 400


# ═════════════════════════ loot + review deck ════════════════════════════════
def test_battle_loot_and_the_review_deck_come_from_stored_misses(hero, llm, monkeypatch):
    c, _ = hero
    bid = start(c)["battle_id"]
    q1 = question(c, bid)["question"]
    answer(c, bid, q1["id"], wrong(q1["options"], bid, q1["id"]))
    play(c, bid, True)
    out = c.post(f"/arena/battles/{bid}/forfeit").json()
    loot = out["battle"]["result"]["missed"]
    assert [m["question"] for m in loot] == [q1["question"]]

    async def no_llm(*a, **k):
        raise AssertionError("the review deck must not call the LLM")
    monkeypatch.setattr("core_brains.boss_brain.generate_battle_quiz_async", no_llm)
    deck = c.get("/study/review-deck", params={"session_id": SID}).json()
    assert deck["total"] == 1 and deck["cards"][0]["front"] == q1["question"]
    assert deck["cards"][0]["back"] == truth(bid, q1["id"]) and deck["cards"][0]["source"] == "arena"
