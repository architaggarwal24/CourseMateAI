"""Arena v2 tactical turns (docs/arena-v2.md section 2): the boss telegraphs an intent, the player picks a move
(which decides the question's tier, time and damage), Focus pays for Heavy and spells, and one answer response
carries the whole resolution plus the next intent. Everything is decided by the server."""
import json
import random

import state
from core_brains import boss_brain
from services import arena_service
from services.arena_service import PLAYER_MAX_HP, SECONDS_PER_QUESTION
from arena_v2_support import (  # noqa: F401  (fixtures)
    _clean_v2_tables, _plain_pacing, llm, intents, hero,
    start, question, truth, wrong, answer, play, row, set_intent, set_focus, hit,
)


# ═════════════════════════ intents in state ══════════════════════════════════
def test_a_new_battle_shows_the_first_intent_and_empty_focus(hero):
    c, _ = hero
    data = start(c)
    battle = data["battle"]
    assert battle["intent"] == {"kind": "attack", "name": "Slam", "value": 2,
                                "description": battle["intent"]["description"]}
    assert battle["focus"] == 0 and battle["focus_cap"] == 5 and battle["shield"] == 0 and battle["mode"] == "quick"
    assert json.loads(row(data["battle_id"])["intent_json"])["kind"] == "attack"


# ═════════════════════════ moves ═════════════════════════════════════════════
def test_without_a_move_old_clients_get_a_strike(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    q = question(c, bid)["question"]
    assert q["move"] == "strike" and q["tier"] == "medium" and q["time_limit"] == SECONDS_PER_QUESTION
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["correct"] and out["move"] == "strike" and out["damage_dealt"] == hit(1)
    assert out["damage_taken"] == 1                       # hard attack = 2, a right answer halves it (floor)
    assert out["focus"] == 1 and out["focus_gained"] == 1
    assert out["next_intent"]["kind"] == "attack" and out["battle"]["intent"] == out["next_intent"]
    assert out["intent"]["kind"] == "attack"              # the intent that just resolved


def test_jab_is_an_easy_quick_question_for_less_damage_and_more_focus(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    q = question(c, bid, "jab")["question"]
    assert q["move"] == "jab" and q["tier"] == "easy" and q["time_limit"] == 15
    assert 0 < q["seconds_left"] <= 15
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["damage_dealt"] == int(hit(1) * 0.6) and out["focus"] == 2


def test_heavy_needs_two_focus_and_hits_hard(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    r = c.get(f"/arena/battles/{bid}/question", params={"move": "heavy"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_enough_focus"
    assert row(bid)["current_seq"] is None                # nothing was issued
    play(c, bid, True)
    play(c, bid, True)                                     # 2 Focus
    q = question(c, bid, "heavy")["question"]
    assert q["move"] == "heavy" and q["tier"] == "hard" and row(bid)["focus"] == 0     # paid when issued
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["damage_dealt"] == int(hit(3) * 1.8) and out["focus"] == 1


def test_an_unknown_move_is_refused(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    r = c.get(f"/arena/battles/{bid}/question", params={"move": "fireball"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_move"


def test_guard_blocks_the_intent_and_earns_focus_but_deals_nothing(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    set_intent(bid, "heavy")
    out = play(c, bid, True, "guard")
    assert out["damage_dealt"] == 0 and out["damage_taken"] == 0 and out["blocked"] is True
    assert out["focus"] == 2 and out["battle"]["boss"]["hp"] == 160


def test_a_wrong_guard_does_not_block(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    set_intent(bid, "heavy")
    out = play(c, bid, False, "guard")
    assert out["damage_taken"] == 4 and out["blocked"] is False and out["focus"] == 0


def test_the_move_survives_a_refresh_and_a_second_move_is_ignored(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    first = question(c, bid, "jab")["question"]
    again = question(c, bid, "guard")["question"]
    assert again["id"] == first["id"] and again["move"] == "jab"


def test_missing_tier_falls_back_to_the_nearest_but_damage_follows_the_move(hero, llm):
    c, _ = hero
    llm.tiers = ("medium",)                               # the pool has no hard question
    bid = start(c)["battle_id"]
    set_focus(bid, 2)
    q = question(c, bid, "heavy")["question"]
    assert q["move"] == "heavy" and q["tier"] == "medium"
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["damage_dealt"] == int(hit(1) * 1.8)


# ═════════════════════════ intents resolve ═══════════════════════════════════
def test_attack_and_heavy_mitigation(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    assert play(c, bid, False)["damage_taken"] == 2       # attack, wrong: full
    set_intent(bid, "heavy")
    assert play(c, bid, False)["damage_taken"] == 4       # heavy = 2x base
    set_intent(bid, "heavy")
    assert play(c, bid, True)["damage_taken"] == 2        # right answer: half
    assert row(bid)["player_hp"] == PLAYER_MAX_HP - 8


def test_a_timeout_takes_the_full_intent(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    set_intent(bid, "heavy")
    q = question(c, bid)["question"]
    past = arena_service._iso(arena_service._now() - arena_service.timedelta(seconds=60))
    state.store.execute("UPDATE arena_questions SET deadline_at = ? WHERE battle_id = ? AND seq = ?", (past, bid, q["id"]))
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["timed_out"] and out["damage_taken"] == 4


def test_shield_absorbs_the_next_hits_but_not_a_weakness_hit(hero, llm):
    c, _ = hero
    llm.weakness = "mitosis"
    llm.tiers = ("medium",)                                # strikes take the pool in order
    llm.concept = lambda phase, n, i: "Mitosis phases" if i == 3 else f"other-{n}-{i}"    # the 4th is the weakness
    bid = start(c)["battle_id"]
    set_intent(bid, "shield")
    first = play(c, bid, False)                            # the shield turn: no damage, the boss gains 16
    assert first["damage_taken"] == 0 and first["battle"]["shield"] == 16 and first["intent"]["kind"] == "shield"
    second = play(c, bid, True)                            # 36 - 16 absorbed
    assert second["shield_absorbed"] == 16 and second["damage_dealt"] == hit(1) - 16 and second["battle"]["shield"] == 0
    set_intent(bid, "shield")
    play(c, bid, False)                                    # another 16 shield
    weak = play(c, bid, True)
    assert weak["weakness"] and weak["shield_absorbed"] == 0 and weak["damage_dealt"] == hit(1) * 2
    assert weak["battle"]["shield"] == 16                  # untouched


def test_drain_takes_all_focus_on_a_miss_only(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    set_focus(bid, 3)
    set_intent(bid, "drain")
    kept = play(c, bid, True)
    assert kept["focus"] == 4 and kept["damage_taken"] == 0
    set_intent(bid, "drain")
    drained = play(c, bid, False)
    assert drained["focus"] == 0 and drained["focus_drained"] == 4 and drained["damage_taken"] == 0


def test_heal_is_interrupted_only_by_a_right_strike_or_heavy(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    play(c, bid, True)                                     # boss 160 - 36 = 124
    set_intent(bid, "heal")
    jab = play(c, bid, True, "jab")                        # a right jab does not interrupt
    amount = round(160 * 0.08)
    assert jab["boss_healed"] == amount
    assert jab["battle"]["boss"]["hp"] == 124 - int(hit(2) * 0.6) + amount
    hp = jab["battle"]["boss"]["hp"]
    set_intent(bid, "heal")
    strike = play(c, bid, True)
    assert strike["boss_healed"] == 0 and strike["interrupted"] is True
    assert strike["battle"]["boss"]["hp"] == hp - hit(3)
    set_intent(bid, "heal")
    miss = play(c, bid, False)
    assert miss["boss_healed"] == amount


def test_combo_resets_on_a_miss_but_focus_stays(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    play(c, bid, True)
    play(c, bid, True)
    miss = play(c, bid, False)
    assert miss["combo"] == 0 and miss["focus"] == 2


def test_focus_is_capped(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    set_focus(bid, 5)
    assert play(c, bid, True, "jab")["focus"] == 5


def test_the_real_intent_table_unlocks_heal_only_in_rage():
    rng = random.Random(7)
    calm = {"phase": 1, "rage": False, "max_hp": 100, "attack_names": ["Slam"]}
    rage = {"phase": 2, "rage": True, "max_hp": 100, "attack_names": ["Slam"]}
    calm_kinds = {boss_brain.roll_intent(calm, "hard", rng=rng)["kind"] for _ in range(400)}
    rage_kinds = {boss_brain.roll_intent(rage, "hard", rng=rng)["kind"] for _ in range(400)}
    assert calm_kinds == {"attack", "heavy", "shield", "drain"}
    assert rage_kinds == set(boss_brain.INTENT_KINDS)
    assert boss_brain.make_intent("attack", rage, "hard")["value"] == 3          # rage base
    assert boss_brain.make_intent("heavy", calm, "nightmare")["value"] == 6
    assert boss_brain.make_intent("shield", calm, "hard", shield_factor=0.5)["value"] == 5


def test_phase_two_rolls_rage_damage_for_the_next_turn(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    for _ in range(3):
        last = play(c, bid, True)                          # into phase 2 on the third hit
    assert last["phase_changed"] and last["next_intent"]["value"] == 3
    assert play(c, bid, False)["damage_taken"] == 3


# ═════════════════════════ spells ════════════════════════════════════════════
def _cast(c, bid, spell):
    return c.post(f"/arena/battles/{bid}/spells", json={"spell": spell})


def test_insight_removes_two_wrong_options_for_one_focus(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    q = question(c, bid)["question"]
    r = _cast(c, bid, "insight")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_enough_focus"
    set_focus(bid, 1)
    ok = _cast(c, bid, "insight").json()
    assert ok["spell"] == "insight" and ok["cost"] == 1 and ok["battle"]["focus"] == 0
    assert len(ok["question"]["options"]) == 2 and truth(bid, q["id"]) in ok["question"]["options"]
    set_focus(bid, 1)
    assert _cast(c, bid, "insight").json()["error"]["code"] == "already_used"


def test_timewarp_adds_fifteen_seconds_once_per_question(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    q = question(c, bid)["question"]
    set_focus(bid, 2)
    ok = _cast(c, bid, "timewarp").json()
    assert ok["question"]["time_limit"] == SECONDS_PER_QUESTION + 15
    assert SECONDS_PER_QUESTION + 13 < ok["question"]["seconds_left"] <= SECONDS_PER_QUESTION + 15
    assert ok["battle"]["focus"] == 1
    again = _cast(c, bid, "timewarp")
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_used"
    assert answer(c, bid, q["id"], truth(bid, q["id"])).json()["correct"]


def test_spells_need_an_open_question_and_a_known_name(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    set_focus(bid, 3)
    assert _cast(c, bid, "timewarp").json()["error"]["code"] == "no_question"
    assert _cast(c, bid, "meteor").status_code == 400
    assert row(bid)["focus"] == 3


# ═════════════════════════ replays + loot ════════════════════════════════════
def test_a_replayed_answer_returns_the_stored_turn(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    q = question(c, bid, "jab")["question"]
    first = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    again = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert again["replayed"] and again["focus"] == first["focus"] and again["next_intent"] == first["next_intent"]
    assert row(bid)["focus"] == 2


def test_a_finished_battle_carries_its_missed_questions_as_loot(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    q = question(c, bid)["question"]
    answer(c, bid, q["id"], wrong(q["options"], bid, q["id"]))
    out = c.post(f"/arena/battles/{bid}/forfeit").json()
    missed = out["battle"]["result"]["missed"]
    assert len(missed) == 1 and missed[0]["correct_answer"] == truth(bid, q["id"])
    assert set(missed[0]) == {"concept", "question", "correct_answer", "explanation"}


# ═════════════════════════ question tiers from the LLM ═══════════════════════
def test_generated_questions_are_filed_under_a_tier():
    from core_brains.llm_schemas import BattleQuiz, question_tier
    raw = {"questions": [
        {"question": "Q1?", "options": ["a", "b", "c", "d"], "correct_answer": "a", "difficulty": "expert"},
        {"question": "Q2?", "options": ["a", "b", "c", "d"], "correct_answer": "b", "difficulty": ""},
        {"question": "Q3?", "options": ["a", "b", "c", "d"], "correct_answer": "c", "difficulty": "Easy"}]}
    out = BattleQuiz.model_validate(raw).finalize("nightmare")["questions"]
    assert [q["difficulty"] for q in out] == ["hard", "hard", "easy"]
    assert question_tier("nonsense") == "medium"


def test_the_quiz_prompt_asks_for_every_tier_and_for_nemesis_targets(monkeypatch):
    import asyncio
    seen = {}

    async def fake_structured(messages, schema):
        seen["prompt"] = messages[-1].content
        from core_brains.llm_schemas import BattleQuiz
        return BattleQuiz.model_validate({"questions": []})

    class VS:
        def search(self, q, k=4):
            return ["ctx"]

    monkeypatch.setattr(boss_brain, "generate_structured_async", fake_structured)
    asyncio.run(boss_brain.generate_battle_quiz_async(VS(), "mitosis", "hard", 6, ["x"], 1,
                                                      target_concepts=["Spindle fibres", "Anaphase"]))
    assert '"easy"' in seen["prompt"] and "TIER MIX" in seen["prompt"]
    assert "NEMESIS" in seen["prompt"] and "- Spindle fibres" in seen["prompt"] and "- Anaphase" in seen["prompt"]
    asyncio.run(boss_brain.generate_battle_quiz_async(VS(), "mitosis", "hard", 6, ["x"], 1))
    assert "NEMESIS" not in seen["prompt"]


# ═════════════════════════ global leaderboard ════════════════════════════════
def _win_quick(c, sid, topic):
    bid = start(c, "hard", topic=topic, sid=sid)["battle_id"]
    for _ in range(12):
        last = play(c, bid, True)
        if last["battle"]["status"] != "active":
            return bid
    raise AssertionError("the boss never fell")


def test_the_global_board_spans_topics_and_documents_for_this_week(hero, make_user, pdf_bytes):
    from test_api import upload
    from arena_v2_support import SID, SID_OTHER
    c, _ = hero
    mine = _win_quick(c, SID, "mitosis")
    other, _ = make_user()
    assert upload(other, SID_OTHER, pdf_bytes).status_code == 202
    _win_quick(other, SID_OTHER, "cell division")
    board = c.get("/arena/leaderboard", params={"scope": "global", "difficulty": "hard"}).json()
    assert board["scope"] == "global" and {e["topic"] for e in board["entries"]} == {"mitosis", "cell division"}
    assert sum(e["is_me"] for e in board["entries"]) == 1
    assert c.get("/arena/leaderboard", params={"scope": "global", "difficulty": "easy"}).json()["entries"] == []
    last_week = arena_service._iso(arena_service.week_start() - arena_service.timedelta(days=1))
    state.store.execute("UPDATE arena_scores SET created_at = ? WHERE battle_id = ?", (last_week, mine))
    board = c.get("/arena/leaderboard", params={"scope": "global", "difficulty": "hard"}).json()
    assert [e["topic"] for e in board["entries"]] == ["cell division"]           # the weekly board started over
    topic_board = c.get("/arena/leaderboard", params={"topic": "mitosis", "difficulty": "hard"}).json()
    assert len(topic_board["entries"]) == 1                                       # the topic board is all-time
    assert c.get("/arena/leaderboard", params={"difficulty": "hard"}).status_code == 400   # a topic board needs a topic


def test_state_says_whether_a_question_is_out_so_a_resumed_screen_can_go_back_to_it(hero):
    c, _ = hero
    bid = start(c)["battle_id"]
    assert c.get(f"/arena/battles/{bid}").json()["battle"]["question_issued"] is False
    q = question(c, bid, "jab")["question"]
    assert c.get(f"/arena/battles/{bid}").json()["battle"]["question_issued"] is True
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["battle"]["question_issued"] is False
