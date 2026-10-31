"""Arena battles are decided by the server: it keeps the boss, hearts, questions and correct answers, grades every
answer, runs the clock, consumes items and pays the rewards - once. Nothing the browser reports can win a fight."""
import json
import threading
import time

import pytest

import state
from conftest import make_pdf_bytes
from services import arena_service
from services.arena_service import BattleService, MAX_BATCHES_PER_PHASE, PLAYER_MAX_HP, SECONDS_PER_QUESTION
from test_api import upload

REAL_PACING = dict(arena_service.HP_PACING)
SID = "55555555-5555-4555-8555-555555555555"
SID_OTHER_DOC = "77777777-7777-4777-8777-777777777777"


# ── fakes ─────────────────────────────────────────────────────────────────────
class FakeLLM:
    """Stands in for boss generation and battle-quiz generation; every question's text says which phase made it."""

    def __init__(self):
        self.calls = []
        self.per_batch = 4
        self.fail = None                   # callable(phase, call_number) -> bool: raise like a provider outage
        self.exc = None                    # what an outage raises (default: a plain RuntimeError)
        self.empty = None                  # callable(phase, call_number) -> bool: answer with no questions at all
        self.concept = None                # callable(phase, n, i) -> concept text
        self.boss_hp = 160
        self.weakness = "unrelated weakness"

    async def boss(self, vector_store, topic, difficulty="hard"):
        return {"name": "The Mitosis Guardian", "title": "Keeper", "tagline": "t", "personality": "p",
                "conceptual_core": "c", "max_hp": self.boss_hp, "rage_threshold": 0.4, "special_ability": "Drain",
                "weakness": self.weakness, "attack_names": ["Slam"], "intro_taunt": "Hello",
                "phase1_taunts": ["p1"], "phase2_taunts": ["p2"], "hit_taunts": ["ouch"], "miss_taunts": ["haha"],
                "defeat_taunt": "argh"}

    async def quiz(self, vector_store, topic, difficulty="normal", num_questions=5, asked_concepts=None, phase=1):
        self.calls.append((phase, list(asked_concepts or [])))
        n = len(self.calls)
        if self.fail and self.fail(phase, n):
            raise self.exc or RuntimeError("provider is down")
        if self.empty and self.empty(phase, n):
            return {"questions": []}
        qs = []
        for i in range(self.per_batch):
            concept = self.concept(phase, n, i) if self.concept else f"concept-p{phase}-b{n}-{i}"
            qs.append({"id": f"q{n}_{i}", "question": f"P{phase} question {n}.{i}?",
                       "options": [f"right-{n}-{i}", f"wrong-a-{n}-{i}", f"wrong-b-{n}-{i}", f"wrong-c-{n}-{i}"],
                       "correct_answer": f"right-{n}-{i}", "explanation": f"because {n}.{i}", "hint": "think",
                       "concept": concept, "difficulty": "medium"})
        return {"questions": qs}


@pytest.fixture(autouse=True)
def _clean_arena_tables():
    """The test database is shared by the whole session: every test starts with no battles, scores or bests."""
    for table in ("arena_personal_bests", "arena_scores", "arena_battles"):
        state.store.execute(f"DELETE FROM {table}")
    yield


@pytest.fixture(autouse=True)
def _plain_pacing(monkeypatch):
    """The rules tests below do their arithmetic on the boss HP the fake LLM gives; the pacing stretch has its own test."""
    monkeypatch.setattr(arena_service, "HP_PACING", {"easy": 1.0, "medium": 1.0, "hard": 1.0, "nightmare": 1.0})


@pytest.fixture(autouse=True)
def _boss_always_attacks(monkeypatch):
    """Arena v2: the boss telegraphs a random intent each turn (attack / heavy / shield / drain / heal). These rules
    tests pin the plain one - `attack`: a miss takes the difficulty's base damage, a right answer half of it (floor).
    The other intents are tested in test_arena_v2_tactics.py."""
    from core_brains.boss_brain import make_intent
    monkeypatch.setattr(arena_service, "roll_intent",
                        lambda boss, difficulty, shield_factor=1.0, rng=None: make_intent("attack", boss, difficulty))


@pytest.fixture()
def llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr("routers.arena.generate_boss_persona_async", fake.boss)
    monkeypatch.setattr("core_brains.boss_brain.generate_battle_quiz_async", fake.quiz)
    return fake


@pytest.fixture()
def hero(make_user, pdf_bytes, llm):
    c, uid = make_user()
    assert upload(c, SID, pdf_bytes).status_code == 202
    return c, uid


def _start(c, difficulty="hard", topic="mitosis", sid=SID):
    r = c.post("/arena/battles", json={"session_id": sid, "topic": topic, "difficulty": difficulty})
    assert r.status_code == 200, r.text
    return r.json()


def _question(c, bid):
    r = c.get(f"/arena/battles/{bid}/question")
    assert r.status_code == 200, r.text
    return r.json()


def _truth(bid, seq):
    """What only the server knows: the correct option of a question (read straight from the database)."""
    row = state.store.fetchone("SELECT question_json FROM arena_questions WHERE battle_id = ? AND seq = ?", (bid, seq))
    return json.loads(row["question_json"])["correct_answer"]


def _wrong(options, bid, seq):
    return next(o for o in options if o != _truth(bid, seq))


def _answer(c, bid, qid, answer):
    return c.post(f"/arena/battles/{bid}/answer", json={"question_id": qid, "answer": answer})


def _play(c, bid, right):
    """Ask for the next question and answer it (right or wrong); returns the answer response body."""
    q = _question(c, bid)["question"]
    pick = _truth(bid, q["id"]) if right else _wrong(q["options"], bid, q["id"])
    r = _answer(c, bid, q["id"], pick)
    assert r.status_code == 200, r.text
    return r.json()


def _row(bid):
    return state.store.fetchone("SELECT * FROM arena_battles WHERE id = ?", (bid,))


def _events(uid, kind):
    return state.store.fetchall("SELECT * FROM reward_events WHERE user_id = ? AND kind = ?", (str(uid), kind))


def _wait(predicate, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if predicate():
            return True
        time.sleep(0.02)
    return False


def _pool(bid, phase):
    return state.store.fetchone(
        "SELECT COUNT(*) AS n FROM arena_questions WHERE battle_id = ? AND phase = ?", (bid, phase))["n"]


def _win(c, bid):
    """Two wrong answers first (6 hearts left on hard), then right ones until the boss falls (each right answer
    still takes half of the boss's attack: 1 heart)."""
    for _ in range(2):
        _play(c, bid, right=False)
    last = None
    for _ in range(12):
        last = _play(c, bid, right=True)
        if last["battle"]["status"] != "active":
            return last
    raise AssertionError("the boss never fell")


# ═════════════════════════ starting a battle ═════════════════════════════════
def test_create_returns_boss_and_battle_id_but_never_an_answer(hero, llm):
    c, _ = hero
    data = _start(c)
    assert data["battle_id"] and data["boss"]["name"] == "The Mitosis Guardian"
    assert data["battle"]["status"] == "active" and data["battle"]["player"] == {"hp": PLAYER_MAX_HP, "max_hp": PLAYER_MAX_HP}
    raw = json.dumps(data)
    assert "correct_answer" not in raw and "right-" not in raw and "because" not in raw
    row = _row(data["battle_id"])
    assert row["status"] == "active" and row["phase"] == 1 and row["combo"] == 0 and row["boss_hp"] == data["boss"]["max_hp"]


def test_boss_hp_is_clamped_to_the_difficulty_range(hero, llm):
    c, _ = hero
    llm.boss_hp = 99_999
    assert _start(c, "easy")["boss"]["max_hp"] == 80            # easy bosses have 40-80 HP
    c.post(f"/arena/battles/{_row_of_session()['id']}/forfeit")
    llm.boss_hp = 1
    assert _start(c, "nightmare")["boss"]["max_hp"] == 140       # nightmare: 140-220


def _row_of_session():
    return state.store.fetchone("SELECT * FROM arena_battles WHERE status = 'active' ORDER BY created_at DESC")


@pytest.mark.parametrize("body", [
    {"topic": "mitosis", "difficulty": "godmode"}, {"topic": "mitosis", "difficulty": "normal"},
    {"topic": "mitosis", "difficulty": ""}, {"topic": "  ", "difficulty": "hard"},
])
def test_difficulty_must_be_on_the_allowlist_and_topic_present(hero, body):
    c, _ = hero
    assert c.post("/arena/battles", json={"session_id": SID, **body}).status_code == 400
    assert state.store.fetchall("SELECT 1 FROM arena_battles") == []


def test_a_battle_needs_one_of_your_own_ready_documents(hero, make_user):
    c, _ = hero
    assert c.post("/arena/battles", json={"session_id": "99999999-9999-4999-8999-999999999999", "topic": "x",
                                          "difficulty": "easy"}).status_code in (400, 404)
    stranger, _ = make_user()
    assert stranger.post("/arena/battles", json={"session_id": SID, "topic": "x", "difficulty": "easy"}).status_code == 403


def test_other_users_cannot_see_or_play_your_battle(hero, make_user):
    c, _ = hero
    bid = _start(c)["battle_id"]
    q = _question(c, bid)["question"]
    stranger, _ = make_user()
    assert stranger.get(f"/arena/battles/{bid}").status_code == 404
    assert stranger.get(f"/arena/battles/{bid}/question").status_code == 404
    assert _answer(stranger, bid, q["id"], q["options"][0]).status_code == 404
    assert stranger.post(f"/arena/battles/{bid}/items", json={"item": "heal"}).status_code == 404
    assert stranger.post(f"/arena/battles/{bid}/forfeit").status_code == 404
    assert _row(bid)["status"] == "active" and _row(bid)["answered"] == 0


# ═════════════════════════ questions ═════════════════════════════════════════
def test_question_has_shuffled_options_no_answer_and_a_server_side_deadline(hero):
    c, _ = hero
    bid = _start(c)["battle_id"]
    body = _question(c, bid)
    q = body["question"]
    raw = json.dumps(body)
    assert "correct_answer" not in raw and "because" not in raw and "explanation" not in raw
    assert sorted(q["options"]) == sorted(json.loads(_stored(bid, q["id"])["question_json"])["options"])
    assert q["time_limit"] == SECONDS_PER_QUESTION and 0 < q["seconds_left"] <= SECONDS_PER_QUESTION
    stored = _stored(bid, q["id"])
    assert stored["status"] == "issued" and stored["deadline_at"] and stored["options_json"]
    assert json.loads(stored["options_json"]) == q["options"]           # the order the server chose is the order stored


def _stored(bid, seq):
    return state.store.fetchone("SELECT * FROM arena_questions WHERE battle_id = ? AND seq = ?", (bid, seq))


def test_options_are_shuffled_by_the_server(hero, llm):
    c, _ = hero
    llm.per_batch = 6
    positions = set()
    for _ in range(3):
        bid = _start(c, "easy")["battle_id"]
        for _ in range(6):
            q = _question(c, bid)["question"]
            positions.add(q["options"].index(_truth(bid, q["id"])))
            _answer(c, bid, q["id"], _wrong(q["options"], bid, q["id"]))      # wrong on purpose: the boss must stay alive
        c.post(f"/arena/battles/{bid}/forfeit")
    assert len(positions) > 1                                    # the right option isn't always in the same slot


def test_asking_again_returns_the_same_question_and_does_not_restart_the_clock(hero):
    c, _ = hero
    bid = _start(c)["battle_id"]
    first = _question(c, bid)["question"]
    deadline = _stored(bid, first["id"])["deadline_at"]
    again = _question(c, bid)["question"]
    assert (again["id"], again["options"], again["expires_at"]) == (first["id"], first["options"], deadline)
    assert _stored(bid, first["id"])["deadline_at"] == deadline


def test_questions_are_deduplicated_by_concept(hero, llm):
    c, _ = hero
    llm.concept = lambda phase, n, i: "Same Concept" if i < 3 else f"other-{n}"
    bid = _start(c)["battle_id"]
    assert _wait(lambda: _pool(bid, 1) > 0)
    _question(c, bid)
    keys = [r["concept_key"] for r in state.store.fetchall("SELECT concept_key FROM arena_questions WHERE battle_id = ?", (bid,))]
    assert len(keys) == len(set(keys))                           # no concept twice in one battle
    assert "same concept" in keys and any(k.startswith("other") for k in keys)
    # the concepts already asked are handed to the generator so it can avoid them
    assert any("Same Concept" in asked for _, asked in llm.calls[1:]) or len(llm.calls) == 1


def test_phase_two_questions_are_prefetched_in_the_background(hero, llm):
    c, _ = hero
    bid = _start(c)["battle_id"]
    assert _wait(lambda: _pool(bid, 1) > 0 and _pool(bid, 2) > 0), "phase 2 was not prefetched"
    assert {p for p, _ in llm.calls} == {1, 2}


# ═════════════════════════ combat: boss_brain's rules ═══════════════════════
def test_a_right_answer_hurts_the_boss_and_a_wrong_one_hurts_the_player(hero):
    c, _ = hero
    bid = _start(c, "hard")["battle_id"]
    hit = _play(c, bid, right=True)
    # apply_player_attack: (25 + 1 combo * 3) * 1.3 for a perfect strike
    assert hit["correct"] and hit["damage_dealt"] == 36 and hit["battle"]["boss"]["hp"] == 160 - 36
    # Arena v2: a right answer no longer deflects everything - it halves the boss's attack (hard: 2 -> 1)
    assert hit["combo"] == 1 and hit["damage_taken"] == 1 and hit["taunt"] and hit["explanation"].startswith("because")
    assert hit["correct_answer"].startswith("right-")
    miss = _play(c, bid, right=False)
    assert not miss["correct"] and miss["damage_dealt"] == 0 and miss["damage_taken"] == 2       # hard: 2 per mistake
    assert miss["combo"] == 0 and miss["battle"]["player"]["hp"] == PLAYER_MAX_HP - 3 and miss["taunt"]
    row = _row(bid)
    assert (row["answered"], row["correct"], row["max_combo"], row["boss_hp"]) == (2, 1, 1, 160 - 36)


def test_combo_rage_threshold_and_phase_two(hero, llm):
    c, _ = hero
    bid = _start(c, "hard")["battle_id"]
    dealt = [_play(c, bid, right=True) for _ in range(3)]
    assert [d["damage_dealt"] for d in dealt] == [36, 40, 44]                    # the combo bonus grows
    assert dealt[2]["phase_changed"] and dealt[2]["battle"]["phase"] == 2 and dealt[2]["battle"]["rage"]
    assert dealt[2]["battle"]["boss"]["hp"] == 40                                 # 120 damage < the 40% rage line
    nxt = _question(c, bid)["question"]
    assert nxt["phase"] == 2 and "P2" in nxt["question"]                          # the rage phase has its own questions
    final = _play(c, bid, right=True)
    assert final["battle"]["status"] == "won" and final["battle"]["boss"]["hp"] == 0


def test_rage_makes_the_boss_hit_harder(hero):
    c, _ = hero
    bid = _start(c, "hard")["battle_id"]
    for _ in range(3):
        _play(c, bid, right=True)                                                 # into phase 2
    miss = _play(c, bid, right=False)
    assert miss["damage_taken"] == 3                                              # hard, enraged


def test_weakness_doubles_the_damage(hero, llm):
    c, _ = hero
    llm.weakness = "mitosis"
    llm.concept = lambda phase, n, i: "Mitosis phases" if i == 0 else f"other-{n}-{i}"
    bid = _start(c, "hard")["battle_id"]
    first = _play(c, bid, right=True)
    assert first["weakness"] and first["damage_dealt"] == 72                       # 36 doubled


def test_the_player_loses_when_the_hearts_run_out(hero):
    c, uid = hero
    bid = _start(c, "hard")["battle_id"]
    last = None
    for _ in range(5):
        last = _play(c, bid, right=False)
    assert last["battle"]["status"] == "lost" and last["battle"]["player"]["hp"] == 0
    assert _events(uid, "boss_defeat") == []
    assert c.get(f"/arena/battles/{bid}/question").json()["question"] is None


# ═════════════════════════ tampered answers ══════════════════════════════════
def test_an_answer_that_is_not_one_of_the_options_is_refused_and_changes_nothing(hero):
    c, _ = hero
    bid = _start(c)["battle_id"]
    q = _question(c, bid)["question"]
    before = _row(bid)
    for bad in ("not an option", "", "right", "A", "x" * 5000):
        assert _answer(c, bid, q["id"], bad).status_code == 400
    after = _row(bid)
    assert (after["answered"], after["boss_hp"], after["player_hp"], after["combo"]) == \
           (before["answered"], before["boss_hp"], before["player_hp"], before["combo"])
    assert _stored(bid, q["id"])["status"] == "issued"                  # still answerable afterwards
    assert _answer(c, bid, q["id"], q["options"][0]).status_code == 200


def test_client_claims_about_the_result_are_ignored(hero):
    c, _ = hero
    bid = _start(c)["battle_id"]
    q = _question(c, bid)["question"]
    wrong = _wrong(q["options"], bid, q["id"])
    r = c.post(f"/arena/battles/{bid}/answer", json={
        "question_id": q["id"], "answer": wrong, "correct": True, "damage": 9999, "boss_hp": 0, "player_hp": 99,
        "combo": 50, "status": "won", "score": 100, "is_correct": True})
    assert r.status_code == 200
    body = r.json()
    assert body["correct"] is False and body["battle"]["status"] == "active"
    assert body["battle"]["boss"]["hp"] == 160 and body["battle"]["player"]["hp"] == PLAYER_MAX_HP - 2


def test_you_cannot_answer_a_question_you_were_not_given(hero):
    c, _ = hero
    bid = _start(c)["battle_id"]
    assert _wait(lambda: _pool(bid, 1) >= 2)
    q = _question(c, bid)["question"]
    future = q["id"] + 1                                                  # queued, not issued yet
    assert _answer(c, bid, future, _truth(bid, future)).status_code == 409
    assert _answer(c, bid, 9999, "anything").status_code == 404
    assert _row(bid)["answered"] == 0 and _stored(bid, future)["status"] == "queued"


def test_a_fifty_fifty_removed_option_cannot_be_picked(hero):
    c, uid = hero
    state.store.add_inventory_item(str(uid), "fifty_fifty", quantity=1)
    bid = _start(c)["battle_id"]
    q = _question(c, bid)["question"]
    r = c.post(f"/arena/battles/{bid}/items", json={"item": "fifty_fifty"})
    assert r.status_code == 200
    left = r.json()["question"]["options"]
    gone = next(o for o in q["options"] if o not in left)
    assert _answer(c, bid, q["id"], gone).status_code == 400


# ═════════════════════════ replayed answers ══════════════════════════════════
def test_replaying_an_answer_changes_nothing(hero):
    c, uid = hero
    bid = _start(c, "hard")["battle_id"]
    q = _question(c, bid)["question"]
    right = _truth(bid, q["id"])
    first = _answer(c, bid, q["id"], right).json()
    assert first["replayed"] is False and first["damage_dealt"] == 36
    snapshot = _row(bid)
    for pick in (right, _wrong(q["options"], bid, q["id"])):                # the same answer, and a "better" one
        again = _answer(c, bid, q["id"], pick)
        assert again.status_code == 200 and again.json()["replayed"] is True
        assert again.json()["damage_dealt"] == 36 and again.json()["correct"] is True      # the first answer stands
    after = _row(bid)
    assert (after["boss_hp"], after["player_hp"], after["combo"], after["answered"], after["correct"]) == \
           (snapshot["boss_hp"], snapshot["player_hp"], snapshot["combo"], snapshot["answered"], snapshot["correct"])


def test_a_wrong_answer_cannot_be_retried_for_a_right_one(hero):
    c, _ = hero
    bid = _start(c)["battle_id"]
    q = _question(c, bid)["question"]
    assert _answer(c, bid, q["id"], _wrong(q["options"], bid, q["id"])).json()["correct"] is False
    retry = _answer(c, bid, q["id"], _truth(bid, q["id"])).json()
    assert retry["replayed"] and retry["correct"] is False
    assert _row(bid)["correct"] == 0


def test_two_simultaneous_answers_count_once(hero):
    c, _ = hero
    bid = _start(c)["battle_id"]
    q = _question(c, bid)["question"]
    results = []

    def go():
        results.append(_answer(c, bid, q["id"], _truth(bid, q["id"])).json())

    threads = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(r["replayed"] for r in results) == [False] + [True] * 5
    assert _row(bid)["answered"] == 1 and _row(bid)["boss_hp"] == 160 - 36


# ═════════════════════════ double finish ═════════════════════════════════════
def test_a_won_battle_pays_exactly_once(hero):
    c, uid = hero
    bid = _start(c, "hard")["battle_id"]
    xp_before = c.get("/profile").json()["progress"]["total_xp"]
    win = _win(c, bid)
    assert win["battle"]["status"] == "won" and win["rewards"]["boss_defeat"]["ok"] and win["rewards"]["arena_round_complete"]["ok"]
    assert len(_events(uid, "boss_defeat")) == 1 and len(_events(uid, "arena_round_complete")) == 1
    xp_after_win = c.get("/profile").json()["progress"]["total_xp"]
    assert xp_after_win > xp_before

    # finishing again, by any route, pays nothing more
    assert c.post(f"/arena/battles/{bid}/forfeit").json()["battle"]["status"] == "won"
    assert state.battle_service._end(uid, bid, "won") is None
    assert state.battle_service._end(uid, bid, "lost") is None
    last_q = state.store.fetchone(
        "SELECT seq FROM arena_questions WHERE battle_id = ? AND status = 'answered' ORDER BY answered_at DESC, seq DESC",
        (bid,))["seq"]
    replay = _answer(c, bid, last_q, "whatever")
    assert replay.status_code == 200 and replay.json()["replayed"] and replay.json()["rewards"] is None
    q = state.store.fetchone("SELECT seq FROM arena_questions WHERE battle_id = ? AND status = 'queued' ORDER BY seq", (bid,))
    if q:
        assert _answer(c, bid, q["seq"], "x").status_code == 409                 # no more answers once it is over
    assert len(_events(uid, "boss_defeat")) == 1 and len(_events(uid, "arena_round_complete")) == 1
    assert c.get("/profile").json()["progress"]["total_xp"] == xp_after_win
    assert _row(bid)["status"] == "won"


def test_racing_finishes_pay_once(hero):
    c, uid = hero
    bid = _start(c, "hard")["battle_id"]
    for _ in range(5):
        _play(c, bid, right=False)                                              # lost: 5 answers = one round paid
    assert _row(bid)["status"] == "lost"
    results = []
    threads = [threading.Thread(target=lambda: results.append(c.post(f"/arena/battles/{bid}/forfeit").status_code))
               for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert set(results) == {200}
    assert len(_events(uid, "arena_round_complete")) == 1 and _events(uid, "boss_defeat") == []


def test_forfeit_is_a_loss_and_pays_no_boss_defeat(hero):
    c, uid = hero
    bid = _start(c)["battle_id"]
    _play(c, bid, right=True)
    out = c.post(f"/arena/battles/{bid}/forfeit").json()
    assert out["battle"]["status"] == "lost" and out["rewards"]["boss_defeat"] is None
    assert out["battle"]["rewards"] == out["rewards"]                          # a refresh still shows what it paid
    assert out["rewards"]["arena_round_complete"] is None                      # under a full round: nothing to pay
    assert _events(uid, "boss_defeat") == [] and state.store.fetchall("SELECT 1 FROM arena_scores") == []


# ═════════════════════════ expired deadline ══════════════════════════════════
def _expire(bid, seq, seconds_late=SECONDS_PER_QUESTION):
    past = arena_service._iso(arena_service._now() - arena_service.timedelta(seconds=seconds_late))
    state.store.execute("UPDATE arena_questions SET deadline_at = ? WHERE battle_id = ? AND seq = ?", (past, bid, seq))


def test_an_answer_after_the_deadline_is_a_timeout_even_if_it_is_right(hero):
    c, _ = hero
    bid = _start(c, "hard")["battle_id"]
    q = _question(c, bid)["question"]
    _expire(bid, q["id"])
    r = _answer(c, bid, q["id"], _truth(bid, q["id"]))
    body = r.json()
    assert r.status_code == 200 and body["timed_out"] is True and body["correct"] is False
    assert body["damage_dealt"] == 0 and body["damage_taken"] == 2 and body["battle"]["boss"]["hp"] == 160
    assert body["battle"]["player"]["hp"] == PLAYER_MAX_HP - 2


def test_the_grace_period_forgives_a_slow_network_but_not_a_slow_player(hero):
    c, _ = hero
    bid = _start(c)["battle_id"]
    q = _question(c, bid)["question"]
    _expire(bid, q["id"], seconds_late=1)                                       # one second past the deadline: within grace
    assert _answer(c, bid, q["id"], _truth(bid, q["id"])).json()["correct"] is True


def test_refreshing_after_the_deadline_cannot_dodge_the_penalty(hero):
    c, _ = hero
    bid = _start(c, "hard")["battle_id"]
    q = _question(c, bid)["question"]
    _expire(bid, q["id"])
    body = c.get(f"/arena/battles/{bid}/question").json()
    assert body["previous"]["timed_out"] and body["previous"]["question_id"] == q["id"]
    assert body["question"]["id"] != q["id"]                                    # a fresh question, a fresh clock
    assert body["battle"]["player"]["hp"] == PLAYER_MAX_HP - 2
    assert _answer(c, bid, q["id"], _truth(bid, q["id"])).json()["replayed"] is True        # and the old one stays closed


def test_a_battle_state_read_settles_an_overdue_question_too(hero):
    c, _ = hero
    bid = _start(c, "hard")["battle_id"]
    q = _question(c, bid)["question"]
    _expire(bid, q["id"])
    assert c.get(f"/arena/battles/{bid}").json()["battle"]["player"]["hp"] == PLAYER_MAX_HP - 2


def test_timeouts_can_lose_the_battle(hero):
    c, _ = hero
    bid = _start(c, "hard")["battle_id"]
    for _ in range(5):
        q = _question(c, bid)["question"]
        _expire(bid, q["id"])
        c.get(f"/arena/battles/{bid}")
    assert _row(bid)["status"] == "lost"


# ═════════════════════════ LLM outage ════════════════════════════════════════
def test_an_llm_outage_mid_battle_never_wins_and_is_retryable(hero, llm):
    c, uid = hero
    llm.per_batch = 2
    llm.fail = lambda phase, n: n >= 2                     # the first batch works, then the provider goes down
    bid = _start(c, "hard")["battle_id"]
    assert _wait(lambda: _pool(bid, 1) >= 2)
    _play(c, bid, right=False)
    _play(c, bid, right=False)                              # the pool is empty now
    before = _row(bid)

    r = c.get(f"/arena/battles/{bid}/question")
    assert r.status_code == 503
    err = r.json()["error"]
    assert err["code"] == "battle_generation_failed" and err["action"] == "retry" and err["details"] == {"retryable": True}
    assert "provider is down" not in json.dumps(err)       # nothing internal leaks
    after = _row(bid)
    assert after["status"] == "active" and (after["boss_hp"], after["player_hp"], after["answered"]) == \
           (before["boss_hp"], before["player_hp"], before["answered"])
    assert _events(uid, "boss_defeat") == [] and state.store.fetchall("SELECT 1 FROM arena_scores") == []
    assert c.get(f"/arena/battles/{bid}").json()["battle"]["status"] == "active"

    llm.fail = None                                         # the provider is back: the same battle simply continues
    again = c.get(f"/arena/battles/{bid}/question")
    assert again.status_code == 200 and again.json()["question"] is not None
    assert _play(c, bid, right=True)["correct"]


def test_provider_quota_errors_keep_their_own_code(hero, llm):
    from core_brains.llm_connection import QuotaExceededError
    c, _ = hero
    llm.per_batch = 1
    llm.exc = QuotaExceededError("gemini")
    llm.fail = lambda phase, n: n >= 2                     # one question, then the quota runs out
    bid = _start(c)["battle_id"]
    assert _wait(lambda: _pool(bid, 1) >= 1)
    _play(c, bid, right=False)
    r = c.get(f"/arena/battles/{bid}/question")
    assert r.status_code == 429 and r.json()["error"]["code"] == "provider_quota"
    assert _row(bid)["status"] == "active"


def test_an_outage_while_creating_the_boss_creates_no_battle(hero, monkeypatch):
    c, _ = hero

    async def down(*a, **k):
        raise RuntimeError("boom")
    monkeypatch.setattr("routers.arena.generate_boss_persona_async", down)
    r = c.post("/arena/battles", json={"session_id": SID, "topic": "mitosis", "difficulty": "hard"})
    assert r.status_code >= 500 and r.json()["error"]["action"] == "retry"
    assert state.store.fetchall("SELECT 1 FROM arena_battles") == []


def test_a_pool_that_can_never_be_filled_is_retryable_never_a_loss_or_a_win(hero, llm):
    """Arena v2 review: a spent question budget used to END the battle as lost. It is LLM trouble, so now it is a
    retryable 503 and the battle stays as it is (the player may retry or forfeit)."""
    c, uid = hero
    llm.per_batch = 1
    llm.empty = lambda phase, n: n >= 2                    # after the first question the generator has nothing usable
    bid = _start(c, "hard")["battle_id"]
    assert _wait(lambda: _pool(bid, 1) >= 1)
    _play(c, bid, right=False)
    for _ in range(MAX_BATCHES_PER_PHASE + 2):
        r = c.get(f"/arena/battles/{bid}/question")
        assert r.status_code == 503 and r.json()["error"]["code"] == "battle_generation_failed"
    assert _row(bid)["status"] == "active" and _events(uid, "boss_defeat") == []
    assert state.store.fetchall("SELECT 1 FROM arena_scores") == []


# ═════════════════════════ resume ════════════════════════════════════════════
def test_a_page_refresh_resumes_the_same_battle(hero):
    c, _ = hero
    first = _start(c, "hard")
    q = _question(c, first["battle_id"])["question"]
    again = _start(c, "hard")                                    # the summon screen runs again after a refresh
    assert again["battle_id"] == first["battle_id"] and again["resumed"] is True
    active = c.get("/arena/battles/active", params={"session_id": SID}).json()["battle"]
    assert active["battle_id"] == first["battle_id"] and active["boss_profile"]["name"] == "The Mitosis Guardian"
    assert _question(c, first["battle_id"])["question"]["id"] == q["id"]
    assert _question(c, first["battle_id"])["stock"] == {"heal": 0, "fifty_fifty": 0}   # what the item buttons show
    anywhere = c.get("/arena/battles/active").json()["battle"]               # a new tab: no document id to ask with
    assert anywhere["battle_id"] == first["battle_id"] and anywhere["session_id"] == SID
    assert len(state.store.fetchall("SELECT 1 FROM arena_battles")) == 1


def test_a_different_topic_cannot_start_while_a_fight_is_running(hero):
    c, _ = hero
    first = _start(c, "hard")
    r = c.post("/arena/battles", json={"session_id": SID, "topic": "meiosis", "difficulty": "hard"})
    assert r.status_code == 409 and r.json()["error"]["details"] == {"battle_id": first["battle_id"]}
    assert c.get("/arena/battles/active", params={"session_id": SID_OTHER_DOC}).json() == {"ok": True, "battle": None}
    c.post(f"/arena/battles/{first['battle_id']}/forfeit")
    assert _start(c, "hard", topic="meiosis")["resumed"] is False


def test_the_fight_survives_a_server_restart(hero, llm, monkeypatch):
    c, uid = hero
    llm.per_batch = 2
    bid = _start(c, "hard")["battle_id"]
    assert _wait(lambda: _pool(bid, 1) >= 2)
    q = _question(c, bid)["question"]
    _answer(c, bid, q["id"], _truth(bid, q["id"]))
    q2 = _question(c, bid)["question"]
    expires = q2["expires_at"]

    # "restart": every in-memory thing is gone, a brand new service object reads the database
    for task in list(state.battle_service._tasks.values()):
        task.cancel()
    fresh = BattleService(state.store, state.reward_service, state.buff_service, state.documents)
    monkeypatch.setattr("routers.arena.battle_service", fresh)
    monkeypatch.setattr("state.battle_service", fresh)

    resumed = c.get("/arena/battles/active", params={"session_id": SID}).json()["battle"]
    assert resumed["battle_id"] == bid and resumed["boss"]["hp"] == 160 - 36 and resumed["combo"] == 1
    same = _question(c, bid)["question"]
    assert (same["id"], same["options"], same["expires_at"]) == (q2["id"], q2["options"], expires)   # same question, same clock
    done = _answer(c, bid, q2["id"], _truth(bid, q2["id"])).json()
    assert done["correct"] and done["combo"] == 2 and done["battle"]["boss"]["hp"] == 160 - 36 - 40
    # and the pool is refilled lazily by the new process
    assert _question(c, bid)["question"] is not None


def test_an_overdue_question_is_settled_after_a_restart(hero, monkeypatch):
    c, _ = hero
    bid = _start(c, "hard")["battle_id"]
    q = _question(c, bid)["question"]
    _expire(bid, q["id"])
    fresh = BattleService(state.store, state.reward_service, state.buff_service, state.documents)
    monkeypatch.setattr("routers.arena.battle_service", fresh)
    assert c.get(f"/arena/battles/{bid}").json()["battle"]["player"]["hp"] == PLAYER_MAX_HP - 2


# ═════════════════════════ items ═════════════════════════════════════════════
def _stock(uid, item):
    return state.store.get_inventory_quantity(str(uid), item)


def test_a_potion_without_stock_is_refused_and_heals_nothing(hero):
    c, uid = hero
    bid = _start(c, "hard")["battle_id"]
    _play(c, bid, right=False)                                                  # 8 hearts left
    assert _stock(uid, "potion_health_small") == 0
    r = c.post(f"/arena/battles/{bid}/items", json={"item": "heal"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_stock"
    assert _row(bid)["player_hp"] == PLAYER_MAX_HP - 2 and _row(bid)["heals_used"] == 0
    # the old way of claiming potions is gone
    assert c.post("/arena/sync-inventory", json={"potion_health_small": 3}).status_code in (404, 405)
    assert _stock(uid, "potion_health_small") == 0


def test_a_potion_heals_one_heart_and_is_consumed(hero):
    c, uid = hero
    state.store.add_inventory_item(str(uid), "potion_health_small", quantity=1)
    bid = _start(c, "hard")["battle_id"]
    _play(c, bid, right=False)
    r = c.post(f"/arena/battles/{bid}/items", json={"item": "heal"}).json()
    assert r["battle"]["player"]["hp"] == PLAYER_MAX_HP - 1 and r["battle"]["heals_used"] == 1
    assert _stock(uid, "potion_health_small") == 0 and r["stock"]["heal"] == 0
    _play(c, bid, right=False)
    assert c.post(f"/arena/battles/{bid}/items", json={"item": "heal"}).status_code == 409      # that was the only one
    assert _row(bid)["player_hp"] == PLAYER_MAX_HP - 3


def test_an_activated_heal_is_used_before_the_inventory(hero):
    c, uid = hero
    state.store.add_inventory_item(str(uid), "potion_health_small", quantity=1)
    state.buff_service.apply_buff(str(uid), "heal_1")                           # one activated charge as well
    state.store.consume_inventory_item(str(uid), "potion_health_small")
    state.store.add_inventory_item(str(uid), "potion_health_small", quantity=1)
    bid = _start(c, "hard")["battle_id"]
    _play(c, bid, right=False)
    c.post(f"/arena/battles/{bid}/items", json={"item": "heal"})
    assert state.buff_service.get_heal_count(str(uid)) == 0 and _stock(uid, "potion_health_small") == 1


def test_healing_at_full_hearts_wastes_nothing(hero):
    c, uid = hero
    state.store.add_inventory_item(str(uid), "potion_health_small", quantity=2)
    bid = _start(c)["battle_id"]
    r = c.post(f"/arena/battles/{bid}/items", json={"item": "heal"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "hp_full"
    assert _stock(uid, "potion_health_small") == 2


def test_fifty_fifty_needs_stock_a_question_and_works_once_per_question(hero):
    c, uid = hero
    bid = _start(c)["battle_id"]
    assert c.post(f"/arena/battles/{bid}/items", json={"item": "fifty_fifty"}).status_code == 409   # no question yet
    q = _question(c, bid)["question"]
    r = c.post(f"/arena/battles/{bid}/items", json={"item": "fifty_fifty"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_stock"
    assert len(_question(c, bid)["question"]["options"]) == 4                  # nothing was hidden

    state.store.add_inventory_item(str(uid), "fifty_fifty", quantity=2)
    ok = c.post(f"/arena/battles/{bid}/items", json={"item": "fifty_fifty"}).json()
    assert len(ok["question"]["options"]) == 2 and _truth(bid, q["id"]) in ok["question"]["options"]
    assert _stock(uid, "fifty_fifty") == 1
    twice = c.post(f"/arena/battles/{bid}/items", json={"item": "fifty_fifty"})
    assert twice.status_code == 409 and twice.json()["error"]["code"] == "already_used" and _stock(uid, "fifty_fifty") == 1
    assert len(_question(c, bid)["question"]["options"]) == 2                    # a refresh keeps it


def test_unknown_items_and_finished_battles_are_refused(hero):
    c, uid = hero
    state.store.add_inventory_item(str(uid), "potion_health_small", quantity=1)
    bid = _start(c)["battle_id"]
    assert c.post(f"/arena/battles/{bid}/items", json={"item": "elixir"}).status_code == 400
    assert c.post(f"/arena/battles/{bid}/items", json={"item": "potion_health_small"}).status_code == 400
    c.post(f"/arena/battles/{bid}/forfeit")
    assert c.post(f"/arena/battles/{bid}/items", json={"item": "heal"}).status_code == 409
    assert _stock(uid, "potion_health_small") == 1


# ═════════════════════════ leaderboard + personal best ═══════════════════════
def test_the_leaderboard_row_comes_from_the_server_measured_result(hero, make_user, pdf_bytes):
    c, uid = hero
    bid = _start(c, "hard", topic="Mitosis ")["battle_id"]
    win = _win(c, bid)
    result = win["battle"]["result"]
    assert result["accuracy"] == round(100 * _row(bid)["correct"] / _row(bid)["answered"]) and result["grade"] in ("C", "D", "B")
    assert result["new_personal_best"] is True and result["time_seconds"] >= 1
    board = c.get("/arena/leaderboard", params={"topic": " MITOSIS", "difficulty": "hard"}).json()["entries"]
    assert len(board) == 1 and board[0]["rank"] == 1 and board[0]["is_me"] is True
    assert (board[0]["accuracy"], board[0]["time"], board[0]["grade"]) == (result["accuracy"], result["time_seconds"], result["grade"])
    assert "user_id" not in board[0]
    # the key is topic + difficulty + document: another difficulty or another document is another board
    assert c.get("/arena/leaderboard", params={"topic": "mitosis", "difficulty": "easy"}).json()["entries"] == []
    own_doc = c.get("/arena/leaderboard", params={"topic": "mitosis", "difficulty": "hard", "session_id": SID}).json()
    assert len(own_doc["entries"]) == 1
    assert upload(c, SID_OTHER_DOC, make_pdf_bytes("Meiosis is something else entirely. " * 40)).status_code == 202
    assert c.get("/arena/leaderboard", params={"topic": "mitosis", "difficulty": "hard", "session_id": SID_OTHER_DOC}
                 ).json()["entries"] == []
    pb = state.store.fetchone("SELECT * FROM arena_personal_bests WHERE user_id = ?", (uid,))
    assert pb["board_key"].startswith("mitosis|hard|") and pb["accuracy"] == result["accuracy"]


def test_only_victories_reach_the_board_and_a_worse_run_keeps_the_personal_best(hero):
    c, uid = hero
    lost = _start(c, "hard")["battle_id"]
    c.post(f"/arena/battles/{lost}/forfeit")
    assert c.get("/arena/leaderboard", params={"topic": "mitosis", "difficulty": "hard"}).json()["entries"] == []

    first = _win(c, _start(c, "hard")["battle_id"])
    assert first["battle"]["result"]["new_personal_best"] is True
    best = state.store.fetchone("SELECT * FROM arena_personal_bests WHERE user_id = ?", (uid,))

    # a sloppier win: more mistakes first (three; four would not survive the half-damage of the right answers)
    bid = _start(c, "hard")["battle_id"]
    for _ in range(3):
        _play(c, bid, right=False)
    for _ in range(12):
        last = _play(c, bid, right=True)
        if last["battle"]["status"] != "active":
            break
    assert last["battle"]["status"] == "won" and last["battle"]["result"]["new_personal_best"] is False
    assert state.store.fetchone("SELECT * FROM arena_personal_bests WHERE user_id = ?", (uid,)) == best
    board = c.get("/arena/leaderboard", params={"topic": "mitosis", "difficulty": "hard"}).json()["entries"]
    assert len(board) == 1 and board[0]["accuracy"] == best["accuracy"]          # one row per player: their best


def test_the_board_ranks_players_by_accuracy_then_time(hero, make_user):
    c, _ = hero
    _win(c, _start(c, "hard")["battle_id"])                                     # 2 wrong then rights: weaker accuracy
    other, _ = make_user()
    assert upload(other, SID_OTHER_DOC, make_pdf_bytes("Mitosis is cell division. " * 40)).status_code == 202
    bid = _start(other, "hard", sid=SID_OTHER_DOC)["battle_id"]
    for _ in range(12):                                                         # flawless
        last = _play(other, bid, right=True)
        if last["battle"]["status"] != "active":
            break
    board = c.get("/arena/leaderboard", params={"topic": "mitosis", "difficulty": "hard"}).json()["entries"]
    assert [e["rank"] for e in board] == [1, 2] and board[0]["accuracy"] == 100 and board[0]["is_me"] is False
    assert board[1]["is_me"] is True


# ═════════════════════════ removed endpoints ═════════════════════════════════
@pytest.mark.parametrize("method,path,body", [
    ("POST", "/arena/leaderboard", {"topic": "t", "difficulty": "hard", "accuracy": 100, "time": 1, "grade": "S+"}),
    ("POST", "/arena/sync-inventory", {"potion_health_small": 3, "fifty_fifty": 2}),
    ("POST", "/rewards/award", {"action_type": "boss_defeat", "accuracy": 1.0}),
])
def test_clients_can_no_longer_report_results_inventory_or_rewards(hero, method, path, body):
    c, uid = hero
    r = c.request(method, path, json=body)
    assert r.status_code in (403, 404, 405)
    assert state.store.fetchall("SELECT 1 FROM arena_scores") == [] and _events(uid, "boss_defeat") == []
    assert state.store.fetchall("SELECT * FROM user_inventory WHERE user_id = ? AND quantity > 0", (str(uid),)) == []


def test_deleting_the_account_removes_its_battles(hero):
    c, uid = hero
    bid = _start(c, "hard")["battle_id"]
    _win(c, bid)
    assert c.delete("/auth/delete-account").status_code == 200
    for table in ("arena_battles", "arena_scores", "arena_personal_bests"):
        assert state.store.fetchall(f"SELECT 1 FROM {table} WHERE user_id = ?", (uid,)) == []
    assert state.store.fetchall("SELECT 1 FROM arena_questions WHERE battle_id = ?", (bid,)) == []


# ═════════════════════════ pacing and gear ═══════════════════════════════════
def _wear(uid, **slots):
    """Put items on the hero (own them and equip them) without going through the shop."""
    def mutate(equipped, owned):
        for slot, item_id in slots.items():
            equipped[slot] = item_id
            if item_id not in owned:
                owned.append(item_id)
    state.store.modify_avatar(str(uid), mutate)


@pytest.fixture()
def naked(hero):
    c, uid = hero
    state.store.modify_avatar(str(uid), lambda equipped, owned: equipped.clear())
    return c, uid


def test_boss_health_is_stretched_so_a_fight_takes_a_real_study_session(hero, llm, monkeypatch):
    monkeypatch.setattr(arena_service, "HP_PACING", REAL_PACING)             # the real pacing table
    c, _ = hero
    llm.boss_hp = 99_999
    first = _start(c, "easy")["boss"]["max_hp"]
    assert first == round(80 * arena_service.HP_PACING["easy"])             # the 40-80 clamp, then the pacing
    c.post(f"/arena/battles/{_row_of_session()['id']}/forfeit")
    llm.boss_hp = 1
    nightmare = _start(c, "nightmare")["boss"]["max_hp"]
    assert nightmare == round(140 * arena_service.HP_PACING["nightmare"])
    assert nightmare > first > 80


def test_a_weapon_adds_damage_to_every_right_answer(naked, llm):
    c, uid = naked
    bare = _start(c, "hard")
    plain = _play(c, bare["battle_id"], right=True)["damage_dealt"]
    c.post(f"/arena/battles/{bare['battle_id']}/forfeit")
    _wear(uid, weapon="weapon_staff_legendary")                               # +30%
    armed = _start(c, "hard")
    hit = _play(c, armed["battle_id"], right=True)
    assert armed["battle"]["gear"]["damage_pct"] == 0.3
    assert hit["gear_bonus"] > 0 and hit["damage_dealt"] == plain + hit["gear_bonus"]
    assert hit["battle"]["boss"]["hp"] == armed["boss"]["max_hp"] - hit["damage_dealt"]


def test_armor_adds_hearts_and_a_potion_can_fill_them(naked, llm):
    c, uid = naked
    _wear(uid, armor="armor_legends_mantle")                                  # +6 hearts
    battle = _start(c, "hard")
    assert battle["battle"]["player"] == {"hp": PLAYER_MAX_HP + 6, "max_hp": PLAYER_MAX_HP + 6}
    hit = _play(c, battle["battle_id"], right=False)
    assert hit["battle"]["player"]["max_hp"] == PLAYER_MAX_HP + 6 and hit["battle"]["player"]["hp"] < PLAYER_MAX_HP + 6


def test_headgear_gives_more_time_per_question(naked, llm):
    c, uid = naked
    _wear(uid, headgear="hat_crown_gold")                                     # +8 seconds
    battle = _start(c, "hard")
    q = _question(c, battle["battle_id"])["question"]
    assert q["time_limit"] == SECONDS_PER_QUESTION + 8
    assert SECONDS_PER_QUESTION + 6 < q["seconds_left"] <= SECONDS_PER_QUESTION + 8


def test_a_pet_strikes_once_the_combo_reaches_three(naked, llm):
    c, uid = naked
    _wear(uid, pet="pet_dragon_ancient")                                      # +20 strike
    bid = _start(c, "hard")["battle_id"]
    hits = [_play(c, bid, right=True) for _ in range(3)]
    assert [h["pet_strike"] for h in hits] == [0, 0, 20]
    assert hits[2]["gear_bonus"] == 20 and hits[2]["combo"] == 3


def test_gear_is_fixed_when_the_battle_starts(naked, llm):
    c, uid = naked
    _wear(uid, weapon="weapon_staff_legendary")
    bid = _start(c, "hard")["battle_id"]
    state.store.modify_avatar(str(uid), lambda equipped, owned: equipped.clear())       # takes it off mid-fight
    hit = _play(c, bid, right=True)
    assert hit["gear_bonus"] > 0 and hit["battle"]["gear"]["damage_pct"] == 0.3


def test_the_shop_lists_what_each_item_does_in_a_fight(make_user):
    c, _ = make_user()
    items = {i["id"]: i for i in c.get("/shop").json()["items"]}
    assert items["weapon_staff_legendary"]["battle"] == {"damage_pct": 0.3}
    assert items["armor_legends_mantle"]["battle"] == {"hp": 6}
    assert items["hat_crown_gold"]["battle"] == {"time_sec": 8}
    assert items["pet_dragon_ancient"]["battle"] == {"strike": 20}
    assert items["hat_headband_red"]["battle"] == {}
