"""Creature mechanics through the real battle API: telegraphed in state, enforced by the server, reported in the
answer. (The rule-by-rule tests are tests/test_arena_mechanics.py.)"""
import json
from datetime import timedelta

import state
from services import arena_service
from arena_v2_support import (  # noqa: F401  (fixtures)
    _clean_v2_tables, _plain_pacing, llm, intents, hero,
    start, question, truth, wrong, answer, play, row, set_focus,
)


def fight(hero, llm, species, difficulty="hard"):
    llm.species = species
    c, _ = hero
    data = start(c, difficulty)
    return c, data["battle_id"], data


def boss_of(bid):
    return json.loads(row(bid)["boss_json"])


def test_the_battle_state_shows_the_creatures_mechanic(hero, llm):
    c, bid, data = fight(hero, llm, "hydra")
    mech = data["battle"]["mechanic"]
    assert mech["id"] == "regrowth" and mech["name"] == "Regrowth" and mech["counters"][0]["label"] == "Heads"
    assert boss_of(bid)["mech"] == {"heads": 0}


def test_a_boss_without_a_creature_has_no_mechanic(hero, llm):
    c, _ = hero
    data = start(c)
    assert data["battle"]["mechanic"] is None
    out = play(c, data["battle_id"], True)
    assert out["mechanic"] is None


def test_hydra_regrows_on_a_miss_and_says_so(hero, llm):
    c, bid, _ = fight(hero, llm, "hydra")
    play(c, bid, True)                                         # wound it first (a full boss can't heal)
    hp = row(bid)["boss_hp"]
    out = play(c, bid, False)
    assert out["mechanic"]["boss_healed"] == round(160 * 0.06)
    assert out["battle"]["boss"]["hp"] == hp + out["mechanic"]["boss_healed"]
    assert out["mechanic"]["events"][0]["type"] == "regrowth"
    assert out["battle"]["mechanic"]["counters"][0]["value"] == 1


def test_kraken_grabs_on_turn_four_and_pins_the_move(hero, llm):
    c, bid, _ = fight(hero, llm, "kraken")
    for _ in range(3):
        out = play(c, bid, True)
    assert out["next_intent"]["kind"] == "grab"
    out = play(c, bid, False, "strike")
    assert out["mechanic"]["events"][0]["type"] == "grabbed"
    assert out["battle"]["mechanic"]["locked_moves"] == ["strike"]
    r = c.get(f"/arena/battles/{bid}/question", params={"move": "strike"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "move_locked"
    assert question(c, bid, "jab")["question"]["move"] == "jab"


def test_sphinx_gets_riddles_from_the_llm_and_insight_cannot_touch_them(hero, llm):
    c, bid, _ = fight(hero, llm, "sphinx")
    play(c, bid, True)
    assert llm.calls and all(kw.get("riddles") is True for _, _, kw in llm.calls)
    out = play(c, bid, True)
    assert out["next_intent"]["kind"] == "riddle"
    set_focus(bid, 3)
    q = question(c, bid)["question"]
    assert q["riddle"] is True and q["special"] == "riddle"
    picked = state.store.fetchone("SELECT question_json FROM arena_questions WHERE battle_id = ? AND seq = ?", (bid, q["id"]))
    assert json.loads(picked["question_json"]).get("riddle") is True          # a riddle the model wrote
    r = c.post(f"/arena/battles/{bid}/spells", json={"spell": "insight"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "riddle_no_insight"
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["mechanic"]["events"][0]["type"] == "riddle_solved" and out["mechanic"]["focus"] == 1


def test_kitsune_hides_an_illusion_among_the_options(hero, llm):
    c, bid, _ = fight(hero, llm, "kitsune")
    play(c, bid, True)
    play(c, bid, True)
    q = question(c, bid)["question"]
    assert q["special"] == "illusion" and len(q["options"]) == 5
    fake = boss_of(bid)["mech"]["illusion"]["option"]
    assert fake in q["options"] and fake != truth(bid, q["id"])
    focus = row(bid)["focus"]
    out = answer(c, bid, q["id"], fake).json()
    assert out["correct"] is False and out["mechanic"]["illusion_picked"] is True
    assert out["focus"] == max(0, focus - 2) and "illusion" not in boss_of(bid)["mech"]


def test_insight_on_a_kitsune_turn_removes_the_illusion_first(hero, llm):
    c, bid, _ = fight(hero, llm, "kitsune")
    play(c, bid, True)
    play(c, bid, True)
    q = question(c, bid)["question"]
    fake = boss_of(bid)["mech"]["illusion"]["option"]
    out = c.post(f"/arena/battles/{bid}/spells", json={"spell": "insight"}).json()
    assert fake not in out["question"]["options"] and len(out["question"]["options"]) == 3


def test_naga_treasure_turn_asks_a_hard_question_whatever_the_move(hero, llm):
    c, bid, _ = fight(hero, llm, "naga")
    for _ in range(3):
        out = play(c, bid, True)
    assert out["next_intent"]["kind"] == "hoard"
    hp_before = row(bid)["player_hp"]
    q = question(c, bid, "jab")["question"]
    assert q["tier"] == "hard" and q["special"] == "hoard"
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["mechanic"]["hearts"] == 1 and out["mechanic"]["focus"] == 2
    assert out["battle"]["player"]["hp"] == min(row(bid)["player_max_hp"], hp_before + 1 - out["damage_taken"])


def test_rakshasa_moves_its_weakness_to_a_concept_in_the_pool(hero, llm):
    c, bid, _ = fight(hero, llm, "rakshasa")
    play(c, bid, True)
    play(c, bid, True)
    out = play(c, bid, True)
    shift = out["mechanic"]["events"][0]
    assert shift["type"] == "shapeshift" and boss_of(bid)["weakness"] == shift["weakness"]
    assert shift["weakness"].startswith("concept-") and out["mechanic"]["shield"] > 0
    assert out["battle"]["mechanic"]["counters"][0]["text"] == shift["weakness"]


def test_jormungandr_coils_squeeze_every_turn(hero, llm):
    c, bid, _ = fight(hero, llm, "jormungandr")
    play(c, bid, False)
    hp = row(bid)["player_hp"]
    out = play(c, bid, True, "guard")                         # blocks the attack, but the coil still squeezes
    assert out["damage_taken"] == 0 and out["mechanic"]["damage"] == 1
    assert out["battle"]["player"]["hp"] == hp - 1 and out["battle"]["mechanic"]["counters"][0]["value"] == 0


def test_simurgh_heals_on_a_slow_answer(hero, llm):
    c, bid, _ = fight(hero, llm, "simurgh")
    play(c, bid, True)
    q = question(c, bid)["question"]
    issued = arena_service._now() - timedelta(seconds=20)          # 20 of 30 seconds used
    state.store.execute("UPDATE arena_questions SET issued_at = ? WHERE battle_id = ? AND seq = ?",
                        (arena_service._iso(issued), bid, q["id"]))
    out = answer(c, bid, q["id"], truth(bid, q["id"])).json()
    assert out["mechanic"]["events"][0]["type"] == "wisdom" and out["mechanic"]["boss_healed"] > 0


def test_cyclops_aims_then_a_right_jab_dodges_the_boulder(hero, llm):
    c, bid, _ = fight(hero, llm, "cyclops")
    play(c, bid, True)
    out = play(c, bid, True)
    assert out["next_intent"]["kind"] == "aim"
    out = play(c, bid, True)
    base = 3 if out["battle"]["rage"] else 2                        # hard: 2, enraged 3
    assert out["damage_taken"] == 0 and out["next_intent"]["kind"] == "throw" and out["next_intent"]["value"] == 3 * base
    out = play(c, bid, True, "jab")
    assert out["dodged"] is True and out["damage_taken"] == 0


def test_minotaur_a_right_guard_on_the_charge_stuns_it(hero, llm):
    c, bid, _ = fight(hero, llm, "minotaur")
    for _ in range(3):
        out = play(c, bid, True)
    assert out["next_intent"]["kind"] == "charge"
    out = play(c, bid, True, "guard")
    assert out["blocked"] and out["next_intent"]["kind"] == "stunned"
    out = play(c, bid, True)
    assert out["damage_taken"] == 0 and out["intent"]["kind"] == "stunned"
